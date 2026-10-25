"""Contract checks for phase-two routes with in-memory asyncpg test doubles.
No live credentials or database mutation needed.
"""
import uuid
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from app import main as core
from app.migration_phase2 import _onboarding_values, _revisit, _library_item

client = TestClient(core.app)
UID = uuid.UUID('daaaaaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'.replace('daaaaaaaaaaa','aaaaaaaa'))
# Avoid relying on server clocks for deterministic snapshots.
NOW = datetime(2026,10,22,10,30,0,tzinfo=timezone.utc)

class Conn:
    def __init__(self, rows=None):
        self.rows = rows if rows is not None else []
        self.calls = []
    async def fetch(self, sql, *args):
        self.calls.append(('fetch',sql,args)); return self.rows
    async def fetchrow(self,sql,*args):
        self.calls.append(('fetchrow',sql,args));return self.rows[0] if self.rows else None
    async def execute(self,sql,*args):
        self.calls.append(('execute',sql,args));return 'INSERT 0 1'
    def transaction(self): return self
    async def __aenter__(self):return self
    async def __aexit__(self,*exc):return False

class FakePool:
    def __init__(self,conn):self.conn=conn
    def acquire(self): return self.conn

def fake_auth_db(monkeypatch, conn):
    async def user(req, active=False):return {'id': UID, 'role':'student','account_status':'active'}
    async def pool():return FakePool(conn)
    monkeypatch.setattr(core,'current_user',user)
    monkeypatch.setattr(core,'pool',pool)


def test_new_endpoints_reject_unauthenticated():
    for method, path in [('PATCH','/api/profile/study'),('GET','/api/vocabulary/summary'),
       ('GET','/api/vocabulary/due'),('GET','/api/vocabulary/abc/contexts'),
       ('DELETE','/api/dictionary/recent')]:
        response=client.request(method,path)
        assert response.status_code==401,(path,response.text)
        assert response.json()=={'error':'unauthenticated'}


def test_study_schema_exactness():
    good={'preferredLanguage':'uz','currentLevel':'B2','targetBand':7.5,'dailyStudyMinutes':45,
          'strongestSkill':'reading','weakestSkill':'speaking'}
    parsed=_onboarding_values(good)
    assert parsed==('B2',None,7.5,None,45,'reading','speaking','uz')
    assert _onboarding_values({**good,'noExtra':'value'}) is None
    assert _onboarding_values({**good,'targetBand':8.25}) is None
    assert _onboarding_values({**good,'dailyStudyMinutes':'4'}) is None
    assert _onboarding_values({**good,'examDate':'2026-02-30'}) is None
    assert _onboarding_values({**good,'examDate':'2028-02-29'}) is not None


def test_study_route_transaction_and_cookie(monkeypatch):
    conn=Conn()
    fake_auth_db(monkeypatch,conn)
    body={'preferredLanguage':'en','currentLevel':'A2','targetBand':'6.5','dailyStudyMinutes':'35',
          'strongestSkill':'speaking','weakestSkill':'writing'}
    assert client.patch('/api/profile/study',json={**body,'nonsense':'extra'}).status_code==400
    r=client.patch('/api/profile/study',json=body)
    assert r.status_code==200 and r.json()=={'ok':True}
    assert 'la_locale=en' in r.headers['set-cookie']
    assert len(conn.calls)==2
    assert conn.calls[0][2][-1]=='writing' and conn.calls[1][2][-1]=='en'


def test_vocab_summary_response(monkeypatch):
    conn=Conn([{'mastery':'new','source_type':None,'total':4,'due':3,'next_due_at':NOW},
               {'mastery':'mastered','source_type':'reading','total':2,'due':0,'next_due_at':None}])
    fake_auth_db(monkeypatch,conn)
    r=client.get('/api/vocabulary/summary')
    assert r.status_code==200 and r.headers['cache-control']=='private, no-store'
    assert r.json()['summary']=={'total':6,'due':3,
        'byMastery':{'new':4,'learning':0,'known':0,'active':0,'mastered':2},
        'bySource':{'manual':4,'reading':2},'nextDueAt':'2026-10-22T10:30:00.000Z'}


def test_due_limited_to_forty_and_empty(monkeypatch):
    conn=Conn([])
    fake_auth_db(monkeypatch,conn)
    r=client.get('/api/vocabulary/due?limit=9000')
    assert r.status_code==200 and r.json()=={'ok':True,'due':[]}
    assert conn.calls[-1][2][-1]==40
    client.get('/api/vocabulary/due?limit=0')
    assert conn.calls[-1][2][-1]==1


def test_revisit_links():
    assert _revisit({'sourceType':'retention','retentionAttemptId':'x'})=='/app/reading/retention'
    assert _revisit({'sourceType':'reading','generalSetId':'a','passageNo':3})=='/app/reading/general/a?passage=3'
    assert _revisit({'sourceType':'listening','listeningTestId':'b','sectionNumber':7})=='/app/listening/tests/b/study'
    assert _revisit({'attemptId':'my-attempt'})=='/app/reading/attempts/my-attempt'
    assert _revisit({}) is None


def test_contexts_reject_bad_uuid(monkeypatch):
    fake_auth_db(monkeypatch,Conn())
    r=client.get('/api/vocabulary/not-a-uuid/contexts')
    assert r.status_code==400 and r.json()=={'error':'invalid_input'}


def test_dictionary_recent_clear_scoped_to_user(monkeypatch):
    conn=Conn()
    fake_auth_db(monkeypatch,conn)
    r=client.delete('/api/dictionary/recent')
    assert r.status_code==200 and r.json()=={'ok':True}
    assert 'WHERE user_id=$1' in conn.calls[-1][1]
    assert conn.calls[-1][2]==(UID,)


def test_retention_summary_calculated_and_levels(monkeypatch):
    class SummaryConn(Conn):
        async def fetch(self,sql,*args):
            self.calls.append(('fetch',sql,args))
            return ([{'level':'A2','attempts':4,'best':95,'average':75},
                     {'level':'C1','attempts':1,'best':100,'average':100}]
                    if 'GROUP BY level' in sql else [{'score':95},{'score':94},{'score':90}])
    conn=SummaryConn()
    fake_auth_db(monkeypatch,conn)
    r=client.get('/api/retention/summary')
    assert r.status_code==200
    d=r.json()
    assert d['completedCount']==5 and d['bestScore']==100
    assert d['lastTenCount']==3 and d['lastTenAverage']==93
    assert len(d['perLevel'])==5 and d['perLevel'][1]['attempts']==0
    assert all(call[2]==(UID,) for call in conn.calls)


def test_retention_history_returns_correct_shape_and_unicode_words(monkeypatch):
    conn=Conn([{'attempt_id':UID,'level':'B1','label':'B1-003','status':'completed',
               'score':80,'recall_text':"well-known 50,000 shouldn't end.",
               'completed_at':NOW,'created_at':NOW,'rotation_cycle':2,'total':15}])
    fake_auth_db(monkeypatch,conn)
    r=client.get('/api/retention/history?page=2')
    assert r.status_code==200
    assert r.json()['pageCount']==2 and r.json()['total']==15
    assert r.json()['rows'][0]['recallWordCount']==4
    assert conn.calls[-1][2]==(UID,10,10)


def test_vocabulary_search_ranking(monkeypatch):
    examples=[('pragmatic','practical sense',None),('A pragmatic choice','context',None),
              ('stand out','be pragmatic in context',None),('useful','not exact','pragmatic')]
    conn=Conn([{'id':uuid.uuid5(uuid.NAMESPACE_DNS,term),'term':term,'definition_en':definition,
               'translation_uz':uz,'mastery':'new','srs_stage':-1,'next_review_at':NOW}
              for term,definition,uz in examples])
    fake_auth_db(monkeypatch,conn)
    r=client.get('/api/vocabulary/search?q=pragmatic')
    assert r.status_code==200
    result=r.json()['results']
    assert [x['match'] for x in result]==['term_exact','word_prefix','definition','translation']
    assert all(x['nextReviewAt']=='2026-10-22T10:30:00.000Z' for x in result)
    assert conn.calls[0][2]==(UID,)


def test_folders_get_user_scoped(monkeypatch):
    conn=Conn([{'id':UID,'name':'My words','created_at':NOW,'count':3}])
    fake_auth_db(monkeypatch,conn)
    r=client.get('/api/vocabulary/folders')
    assert r.status_code==200
    assert r.json()['folders']==[{'id':str(UID),'name':'My words','createdAt':'2026-10-22T10:30:00.000Z','count':3}]
    assert conn.calls[0][2]==(UID,)


def test_folders_create_and_move(monkeypatch):
    class FolderConn(Conn):
        async def fetchrow(self,sql,*args):
            self.calls.append(('fetchrow',sql,args))
            return {'id':UID,'name':'Reading'}
        async def fetchval(self,sql,*args):
            self.calls.append(('fetchval',sql,args))
            return UID
        async def fetch(self,sql,*args):
            self.calls.append(('fetch',sql,args))
            return [{'id':UID}]
    conn=FolderConn()
    fake_auth_db(monkeypatch,conn)
    invalid=client.post('/api/vocabulary/folders',json={'entryIds':[],'folderId':str(UID)})
    assert invalid.status_code==400
    created=client.post('/api/vocabulary/folders',json={'name':'  Reading  '})
    assert created.status_code==200 and created.json()['folder']=={'id':str(UID),'name':'Reading'}
    moved=client.post('/api/vocabulary/folders',json={'entryIds':[str(UID)],'folderId':str(UID)})
    assert moved.status_code==200 and moved.json()=={'ok':True,'moved':1}
    assert conn.calls[-1][2][0]==UID


def test_vocabulary_sentences_history_words_and_offset(monkeypatch):
    class WordsConn(Conn):
        async def fetch(self, sql, *args):
            self.calls.append(('fetch',sql,args))
            if 'FROM vocabulary_usages' in sql:
                return [{'id':UID,'sentence':'A realistic response.','origin':'manual',
                         'riwi_accepted':False,'points_awarded':0,'evaluation_id':None,
                         'created_at':NOW,'term':'realistic'}]
            return [{'id':UID,'term':'realistic','definition_en':'practical',
                     'translation_uz':'haqiqiy','mastery':'known','folder_id':None}]
    conn=WordsConn()
    fake_auth_db(monkeypatch,conn)
    r=client.get('/api/vocabulary/sentences?view=history')
    assert r.status_code==200 and 'words' not in r.json()
    assert r.json()['sentences'][0]['pointsAwarded']==0
    r=client.get('/api/vocabulary/sentences?view=words&limit=2&offset=3')
    assert r.status_code==200 and 'sentences' not in r.json()
    assert r.json()['words'][0]['term']=='realistic'
    assert conn.calls[-1][2][2:]==(3,3)
    r=client.get('/api/vocabulary/sentences?offset=-1')
    assert r.status_code==400 and r.json()['error']=='invalid_input'


def test_telegram_status_hashed_nonce_and_expiry(monkeypatch):
    from datetime import timedelta
    from app.migration_phase2 import _telegram_hash
    class IntentConn(Conn):
        async def fetchrow(self,sql,*args):
            self.calls.append(('fetchrow',sql,args))
            return {'status':'confirmed','expires_at':NOW-timedelta(minutes=1),'purpose':'login'}
    conn=IntentConn()
    async def pool():return FakePool(conn)
    monkeypatch.setattr(core,'pool',pool)
    r=client.get('/api/auth/telegram/intent/status?nonce=abc')
    assert r.status_code==400
    r=client.get(f'/api/auth/telegram/intent/status?id={UID}&nonce=abc')
    assert r.status_code==200 and r.json()=={'status':'expired','expired':True}
    assert conn.calls[-1][2] == (UID,_telegram_hash('abc'))


def test_telegram_cancel_idempotent(monkeypatch):
    from app.migration_phase2 import _telegram_hash
    from app.rate_limit import BUCKETS
    BUCKETS.clear()
    class CancelConn(Conn):
        async def fetchrow(self,sql,*args):
            self.calls.append(('fetchrow',sql,args))
            return {'status':'cancelled'} if 'SELECT status' in sql else None
    conn=CancelConn()
    async def pool():return FakePool(conn)
    monkeypatch.setattr(core,'pool',pool)
    r=client.post('/api/auth/telegram/intent/cancel',json={'intentId':str(UID),'browserNonce':'a'})
    assert r.status_code==200 and r.json()=={'ok':True}
    assert conn.calls[0][2] == (UID,_telegram_hash('a'))


def test_telegram_create_gate_and_purpose_validation(monkeypatch):
    import os
    from app.rate_limit import BUCKETS
    BUCKETS.clear()
    monkeypatch.delenv('TELEGRAM_INTENT_AUTH_ENABLED',raising=False)
    assert client.post('/api/auth/telegram/intent',json={}).json()=={'error':'telegram_not_configured'}
    for key,val in [('TELEGRAM_INTENT_AUTH_ENABLED','true'),('TELEGRAM_BOT_TOKEN','not_a_real_token'),
                    ('TELEGRAM_BOT_USERNAME','test_bot'),('BOT_SERVICE_SECRET','not_a_real_secret')]:
        monkeypatch.setenv(key,val)
    async def user(req, active=False):return None
    monkeypatch.setattr(core,'current_user',user)
    assert client.post('/api/auth/telegram/intent',json={'purpose':'surprise'}).json()=={'error':'invalid_purpose'}
    assert client.post('/api/auth/telegram/intent',json={'purpose':'link'}).status_code==401
    class CreateConn(Conn):
        async def fetchrow(self,sql,*args):
            self.calls.append(('fetchrow',sql,args))
            return {'id':UID}
    conn=CreateConn()
    async def pool():return FakePool(conn)
    monkeypatch.setattr(core,'pool',pool)
    r=client.post('/api/auth/telegram/intent',json={'purpose':'login'})
    assert r.status_code==200 and r.json()['botUsername']=='test_bot'
    assert len(r.json()['token'])==64 and len(r.json()['browserNonce'])==64
    assert r.json()['intentId']==str(UID)
    assert conn.calls[0][2][2] is None and conn.calls[0][2][3]=='login'


def test_password_reset_dev_only_not_account_leak(monkeypatch):
    from app.rate_limit import BUCKETS
    BUCKETS.clear()
    monkeypatch.setenv('PUBLIC_AUTH_MODE','password')
    monkeypatch.setenv('NODE_ENV','production')
    monkeypatch.setenv('ALLOW_DEV_RESET_LINKS','true')
    assert client.post('/api/auth/reset/request',json={'email':'me@test.io'}).json()=={'error':'reset_unavailable'}
    assert client.post('/api/auth/reset/request',json={'email':'invalid'}).status_code==400
    assert client.post('/api/auth/reset/confirm',json={'token':'tiny','password':'abc12345'}).status_code==400


def test_password_reset_consumes_token_one_time(monkeypatch):
    import sys
    from types import SimpleNamespace
    monkeypatch.setitem(sys.modules, 'bcrypt',SimpleNamespace(
        gensalt=lambda rounds: b'unit-test-salt',
        hashpw=lambda password,salt: b'$2b$12$' + b'F'*53
    ))
    conn=Conn()
    conn.rows=[{'id':UID,'user_id':UID}]
    async def pool():return FakePool(conn)
    monkeypatch.setattr(core,'pool',pool)
    monkeypatch.setenv('PUBLIC_AUTH_MODE','password')
    r=client.post('/api/auth/reset/confirm',json={'token':'A'*20,'password':'My-New-Pass123'})
    assert r.status_code==200 and r.json()=={'ok':True}
    executed=[args for typ,sql,args in conn.calls if typ=='execute' and 'UPDATE users' in sql]
    assert len(executed)==1 and executed[0][1]==UID
    assert executed[0][0].startswith('$2') and len(executed[0][0])==60


def test_admin_content_items_filters_and_grouping(monkeypatch):
    class ContentConn(Conn):
        async def fetch(self,sql,*args):
            return [{'module':'reading','content_type':'passage','source_ref':'p001','version_no':3,'publication_state':'published','title':'Updated'},
                    {'module':'reading','content_type':'passage','source_ref':'p001','version_no':2,'publication_state':'draft','title':'Old'},
                    {'module':'writing','content_type':'prompt','source_ref':'p002','version_no':1,'publication_state':'draft','title':'Writing'}]
    async def user(req,active=False):return {'id':UID,'role':'teacher','account_status':'active'}
    async def pool():return FakePool(ContentConn())
    monkeypatch.setattr(core,'current_user',user)
    monkeypatch.setattr(core,'pool',pool)
    r=client.get('/api/admin/content/items?module=reading')
    assert r.status_code==200
    assert r.json()['items']==[{'key':'reading:passage|p001','module':'reading','contentType':'passage',
                                  'sourceRef':'p001','versions':2,'state':'published','title':'Updated'}]


def test_admin_create_permissions_and_validation(monkeypatch):
    async def user(req,active=False):return {'id':UID,'role':'student','account_status':'active'}
    monkeypatch.setattr(core,'current_user',user)
    assert client.post('/api/admin/grammar/topics',json={}).status_code==403
    assert client.post('/api/admin/reading/passages',json={}).status_code==403
    async def admin(req,active=False):return {'id':UID,'role':'admin','account_status':'active'}
    monkeypatch.setattr(core,'current_user',admin)
    assert client.post('/api/admin/grammar/topics',json={'skillArea':'writing','title':'x'}).status_code==400
    assert client.post('/api/admin/reading/passages',json={'title':'x'}).status_code==400


def test_http_route_status_inventory():
    import json
    from pathlib import Path
    status=json.loads(Path(__file__).resolve().parents[1].joinpath('PORT_STATUS.json').read_text())
    registered={(method,route.path) for route in core.app.routes for method in getattr(route,'methods',set()) if method != 'OPTIONS'}
    declared={(e['method'],e['path']) for e in status['endpoints'] if e['status'].startswith('ported_')}
    assert registered==declared, sorted(registered ^ declared)
    assert status['ported_methods']==len(registered)
    assert status['ported_methods']+status['unported_methods']==265
