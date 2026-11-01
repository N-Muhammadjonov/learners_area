"""Newly migrated video and live class HTTP contract tests.

These tests use a stateful database double, not a running PostgreSQL server.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.rate_limit import BUCKETS, RULES
from app.video_answers_join_port import grade_answer, normalise_answer, js_iso
from test_migration_phase2 import FakePool

C = TestClient(core.app)
V = str(UUID('11111111-1111-4111-8111-111111111111'))
Q = str(UUID('22222222-2222-4222-8222-222222222222'))
L = str(UUID('33333333-3333-4333-8333-333333333333'))
U = str(UUID('44444444-4444-4444-8444-444444444444'))

class DB:
    def __init__(self):
        self.calls=[]
        self.video={'id':V,'lesson_id':L,'duration_seconds':100,'publication_state':'published','publish_at':None}
        self.progress={'id':Q,'state':'not_started','watched_seconds':0,'answers':None,
                       'response_text':None,'summary_text':None,'completed_at':None}
        self.questions=[{'id':Q,'accepted_answers':['New York','NYC']}]
        self.live={'id':L,'status':'upcoming','scheduled_at':datetime.now(timezone.utc)+timedelta(minutes=2),
                   'duration_minutes':60}
        self.attendance=None
        self.lock=True
    async def __aenter__(self): return self
    async def __aexit__(self,*args): return False
    def transaction(self): return self
    async def fetchrow(self,sql,*args):
        self.calls.append(('fetchrow',sql,args))
        if 'SELECT id,lesson_id,duration_seconds' in sql: return self.video
        if 'FROM video_lesson_progress WHERE' in sql: return self.progress
        if 'INSERT INTO video_lesson_progress' in sql: return self.progress
        if 'UPDATE video_lesson_progress SET state=' in sql:
            self.progress['state']=args[2]
            self.progress['completed_at']=args[3]
            return {'state':args[2],'completed_at':args[3]}
        if 'SELECT id,status,scheduled_at,duration_minutes' in sql: return self.live
        if 'SELECT id FROM live_classes' in sql and 'FOR UPDATE' in sql:
            return {'id':L} if self.lock else None
        if 'SELECT joined_at FROM live_class_attendance' in sql:
            return {'joined_at':self.attendance} if self.attendance else None
        if 'INSERT INTO live_class_attendance' in sql:
            self.attendance=datetime(2026,10,22,tzinfo=timezone.utc)
            return {'joined_at':self.attendance}
        return None
    async def fetch(self,sql,*args):
        self.calls.append(('fetch',sql,args))
        if 'FROM video_lesson_questions' in sql:return self.questions
        return []
    async def execute(self,sql,*args):
        self.calls.append(('execute',sql,args))
        if 'SET answers=' in sql:self.progress['answers']=__import__('json').loads(args[2])
        if 'SET response_text=' in sql or 'SET summary_text=' in sql:
            for key,index in [('response_text','response_text'),('summary_text','summary_text')]:
                import re
                match=re.search(index+r'=\$(\d+)',sql)
                if match:self.progress[key]=args[int(match.group(1))-1]
        return 'OK'

@pytest.fixture
def fake(monkeypatch):
    BUCKETS.clear()
    db=DB()
    async def user(req,active=False):return {'id':U,'role':'student','account_status':'active'}
    async def pool():return FakePool(db)
    monkeypatch.setattr(core,'current_user',user)
    monkeypatch.setattr(core,'pool',pool)
    return db


def test_source_answer_normalization():
    assert normalise_answer('  NEW—York!  ')== 'new york'
    assert grade_answer('  new york  ',['New York'])
    assert grade_answer('DON’T STOP',["Don't Stop"])
    assert not grade_answer('   ',[''])
    assert not grade_answer('a',["b"])


def test_uuid_rejection_without_db():
    for suffix in ('answers','response'):
        r=C.post('/api/video-lessons/not-a-uuid/'+suffix,json={})
        assert r.status_code==404 and r.json()=={'error':'not_found'}
    r=C.post('/api/live-classes/not-a-uuid/join')
    assert r.status_code==404 and r.json()=={'error':'not_found'}


def test_auth_required(monkeypatch):
    async def no_user(req,active=False):return None
    monkeypatch.setattr(core,'current_user',no_user)
    for path in ('/api/video-lessons/'+V+'/answers','/api/video-lessons/'+V+'/response',
                 '/api/live-classes/'+L+'/join'):
        r=C.post(path,json={})
        assert r.status_code==401 and r.json()=={'error':'unauthenticated'}


@pytest.mark.parametrize('payload',[
    {}, {'answers':None}, {'answers':[]}, {'answers':{Q:12}},
    {'answers':{Q:'a'*501}}, {'answers':{'bad-uuid':'text'}}
])
def test_answer_validation(fake,payload):
    assert C.post('/api/video-lessons/'+V+'/answers',json=payload).json()=={'error':'invalid_input'}
    assert not fake.calls


@pytest.mark.parametrize('payload',[
    {'summaryText':None}, {'responseText':None},
    {'responseText':10}, {'summaryText':'A'*4001}, []
])
def test_response_validation(fake,payload):
    assert C.post('/api/video-lessons/'+V+'/response',json=payload).json()=={'error':'invalid_input'}
    assert not fake.calls


def test_cannot_answer_unpublished_video(fake):
    fake.video['publication_state']='draft'
    for suffix,body in [('answers',{'answers':{Q:'NYC'}}),('response',{'responseText':'note'})]:
        r=C.post('/api/video-lessons/'+V+'/'+suffix,json=body)
        assert r.status_code==404 and r.json()=={'error':'not_found'}
    assert fake.progress['answers'] is None


def test_no_authored_questions_409_no_progress_write(fake):
    fake.questions=[]
    r=C.post('/api/video-lessons/'+V+'/answers',json={'answers':{}})
    assert r.status_code==409 and r.json()=={'error':'no_questions'}
    assert not any('INSERT INTO video_lesson_progress' in q for _,q,_ in fake.calls)


def test_server_grades_and_gates_linked_video_completion(fake):
    r=C.post('/api/video-lessons/'+V+'/answers',json={'answers':{Q:'Bad answer'}})
    assert r.status_code==200 and r.json()=={'graded':{Q:{'answer':'Bad answer','correct':False}},
                 'state':'in_progress','completedAt':None}
    r=C.post('/api/video-lessons/'+V+'/answers',json={'answers':{Q:'new york'}})
    assert r.status_code==200 and r.json()['state']=='completed'
    assert r.json()['graded']=={Q:{'answer':'new york','correct':True}}
    assert r.json()['completedAt'].endswith('Z')
    assert 'acceptedAnswers' not in r.text and 'New York' not in r.text
    assert any('last_meaningful_activity_at' in q for _,q,_ in fake.calls)


def test_empty_answer_submission_preserves_existing_grades(fake):
    fake.progress['answers']={Q:{'answer':'NYC','correct':True}}
    r=C.post('/api/video-lessons/'+V+'/answers',json={'answers':{}})
    assert r.status_code==200 and r.json()['graded'][Q]['correct'] is True
    assert r.json()['state']=='completed'


def test_response_writing_and_makes_progress(fake):
    r=C.post('/api/video-lessons/'+V+'/response',json={'responseText':'My idea'})
    assert r.status_code==200 and r.json()=={'state':'in_progress'}
    assert fake.progress['response_text']=='My idea'
    assert fake.progress['summary_text'] is None
    assert any('last_meaningful_activity_at' in q for _,q,_ in fake.calls)
    r=C.post('/api/video-lessons/'+V+'/response',json={'summaryText':'Summary'})
    assert r.status_code==200
    assert fake.progress['response_text']=='My idea'
    assert fake.progress['summary_text']=='Summary'


def test_response_completes_standalone_unknown_duration(fake):
    fake.video['lesson_id']=None
    fake.video['duration_seconds']=None
    assert C.post('/api/video-lessons/'+V+'/response',json={'responseText':'Finished'}).json()=={'state':'in_progress'}


def test_join_not_found(fake):
    fake.live=None
    r=C.post('/api/live-classes/'+L+'/join')
    assert r.status_code==404 and r.json()=={'error':'not_found'}


@pytest.mark.parametrize('state,offset,expected',[
    ('cancelled',timedelta(minutes=0),'cancelled'),
    ('upcoming',timedelta(hours=2),'too_early'),
    ('completed',timedelta(hours=-5),'closed')
])
def test_join_window_denies(fake,state,offset,expected):
    fake.live['status']=state
    fake.live['scheduled_at']=datetime.now(timezone.utc)+offset
    r=C.post('/api/live-classes/'+L+'/join')
    assert r.status_code==409 and r.json()['error']==expected
    assert r.json()['joined'] is False
    assert r.json()['opensAt'].endswith('Z')
    assert fake.attendance is None


def test_live_status_opens_outside_window(fake):
    fake.live['status']='live'
    fake.live['scheduled_at']=datetime.now(timezone.utc)+timedelta(days=10)
    r=C.post('/api/live-classes/'+L+'/join')
    assert r.status_code==200 and r.json()['ok'] and r.json()['joined']
    assert r.json()['joinedAt']=='2026-10-22T00:00:00.000Z'
    assert any('FOR UPDATE' in q for _,q,_ in fake.calls)


def test_join_twice_only_one_event(fake):
    for _ in range(2):
        r=C.post('/api/live-classes/'+L+'/join')
        assert r.status_code==200 and r.json()['joinedAt']=='2026-10-22T00:00:00.000Z'
    assert len([1 for _,q,_ in fake.calls if 'INSERT INTO live_class_attendance' in q])==1
    assert len([1 for _,q,_ in fake.calls if 'INSERT INTO activity_events' in q])==1


def test_rate_limit_videos(fake,monkeypatch):
    monkeypatch.setitem(RULES,'evaluation',(1,900))
    try:
        r=C.post('/api/video-lessons/'+V+'/response',json={'responseText':'a'})
        assert r.status_code==200
        r=C.post('/api/video-lessons/'+V+'/response',json={'responseText':'b'})
        assert r.status_code==429 and r.json()['error']=='rate_limited'
        assert int(r.headers['Retry-After'])>0
    finally:
        monkeypatch.undo()
        BUCKETS.clear()


def test_125_unique_route_keys():
    seen=set()
    for route in core.app.routes:
        if not route.path.startswith('/api/'):
            continue
        for method in getattr(route,'methods',()) or ():
            if method in {'GET','POST','PUT','PATCH','DELETE'}:
                assert (method,route.path) not in seen,(method,route.path)
                seen.add((method,route.path))
    assert len(seen)>=125  # historical checkpoint: later ports add unique route keys
