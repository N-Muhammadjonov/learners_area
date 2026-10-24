"""Contract and authorization checks for newly ported Speaking/Reading/Feedback.
All persistence calls use in-memory doubles; this does not claim DB parity.
"""
import pytest
from fastapi.testclient import TestClient
from app import main as core
from test_migration_phase2 import FakePool
from uuid import UUID

client=TestClient(core.app)
USER=str(UUID('11111111-1111-4111-8111-111111111111'))
OTHER=str(UUID('22222222-2222-4222-8222-222222222222'))
ATT=str(UUID('33333333-3333-4333-8333-333333333333'))

class Db:
    def __init__(self):
        self.calls=[];self.prompt=None;self.attempt=None;self.submission=None;self.link=False
    async def __aenter__(self):return self
    async def __aexit__(self,*args):return False
    def transaction(self):return self
    async def fetch(self,sql,*args):
        self.calls.append(('fetch',sql,args))
        if 'FROM speaking_attempts' in sql:
            return [self.attempt] if self.attempt else []
        return []
    async def fetchval(self,sql,*args):
        self.calls.append(('fetchval',sql,args))
        if 'teacher_student_links' in sql:return self.link
        if 'SELECT role FROM users' in sql:return 'student'
        if 'SELECT id FROM content_versions' in sql:return None
        if 'RETURNING id' in sql:return ATT
        if 'to_regclass' in sql:return False
        return None
    async def fetchrow(self,sql,*args):
        self.calls.append(('fetchrow',sql,args))
        if 'FROM writing_submissions' in sql:return self.submission
        if 'FROM speaking_prompts' in sql:return self.prompt
        if 'FROM speaking_attempts' in sql:return self.attempt
        if 'INSERT INTO speaking_attempts' in sql:return self.attempt
        return None
    async def execute(self,sql,*args):
        self.calls.append(('execute',sql,args));return 'OK'

@pytest.fixture
def db(monkeypatch):
    db=Db()
    async def user(req,active=False):return {'id':USER,'role':'student','account_status':'active'}
    async def pool():return FakePool(db)
    monkeypatch.setattr(core,'current_user',user)
    monkeypatch.setattr(core,'pool',pool)
    return db

@pytest.mark.parametrize('path,method',[
 ('/api/speaking/ai/script?mode=bad','get'),
 ('/api/speaking/attempts','post'),
 ('/api/reading/attempts','post'),
 ('/api/teacher/feedback','post'),
])
def test_validation_or_permission_fails_before_db(db,path,method):
    resp=getattr(client,method)(path,json={} if method=='post' else None) if method=='post' else client.get(path)
    assert resp.status_code in (400,403)
    assert not db.calls

@pytest.mark.parametrize('payload',[
 {'part':'broken'},{'part':'part1','score':5},{'part':'part1','promptId':'not-uuid'},
 {'part':'part3','transcript':'fake'},{}
])
def test_start_attempt_rejects_forged_data(db,payload):
    r=client.post('/api/speaking/attempts',json=payload)
    assert r.status_code==400 and not db.calls

def test_attempt_not_found_or_forbidden(db):
    r=client.get('/api/speaking/attempts/'+ATT)
    assert r.status_code==404
    db.attempt={'id':ATT,'userId':OTHER,'promptId':None}
    r=client.get('/api/speaking/attempts/'+ATT)
    assert r.status_code==403

def test_not_live_prompt_refused(db):
    from datetime import datetime, timezone
    db.prompt={'id':ATT,'part':'part1','external_id':None,'is_active':True,
            'publication_state':'draft','publish_at':None}
    r=client.post('/api/speaking/attempts',json={'part':'part1','promptId':ATT})
    assert r.status_code==422 and r.json()=={'error':'prompt_not_live'}
    assert not any('INSERT INTO speaking_attempts' in sql for _,sql,_ in db.calls)

def test_teacher_must_own_roster(db,monkeypatch):
    db.submission={'id':ATT,'user_id':OTHER}
    async def teacher(req,active=False):return {'id':USER,'role':'teacher','account_status':'active'}
    monkeypatch.setattr(core,'current_user',teacher)
    data={'submissionId':ATT,'comment':'Improve your evidence','overallBand':7}
    r=client.post('/api/teacher/feedback',json=data)
    assert r.status_code==404
    assert not any('INSERT INTO' in sql for _,sql,_ in db.calls)
    db.link=True
    r=client.post('/api/teacher/feedback',json=data)
    assert r.status_code==200 and r.json()=={'ok':True}
    assert any('INSERT INTO writing_feedback' in sql for _,sql,_ in db.calls)
    assert any('INSERT INTO activity_events' in sql for _,sql,_ in db.calls)

@pytest.mark.parametrize('data',[
 {'answers':{}},{'answers':[{'questionId':'wrong','answer':'no'}]},
 {'answers':[{'questionId':ATT,'answer':9}]},
 {'answers':[{'questionId':ATT,'answer':'z'*501}]},
])
def test_reading_draft_payload(db,data):
    r=client.patch('/api/reading/attempts/'+ATT,json=data)
    assert r.status_code==400
    assert not db.calls


def test_speaking_script_invalid_mode_and_guest(db,monkeypatch):
    assert client.get('/api/speaking/ai/script?mode=all').json()=={'error':'invalid_mode'}
    async def guest(req,active=False):return None
    monkeypatch.setattr(core,'current_user',guest)
    assert client.get('/api/speaking/ai/script').status_code==401
    assert client.get('/api/speaking/attempts').status_code==401
