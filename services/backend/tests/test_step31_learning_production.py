"""HTTP gates and transaction / provider regressions for three new routes.
Tests fake only the database boundary; no live PostgreSQL or provider claimed.
"""
from __future__ import annotations
import json
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app import step31_learning_production as api
from app import step31_coach as coach
from app.step31_riwi_evaluators import gval,vval,sval
from app.step31_riwi_text import contains_form

client=TestClient(core.app)
UID=UUID('11111111-1111-4111-8111-111111111111')
OTHER=UUID('22222222-2222-4222-8222-222222222222')
EID=UUID('33333333-3333-4333-8333-333333333333')
TOPIC=UUID('44444444-4444-4444-8444-444444444444')
LEXEME=UUID('55555555-5555-4555-8555-555555555555')
ATTEMPT=UUID('66666666-6666-4666-8666-666666666666')

class Conn:
    def __init__(self):
        self.calls=[];self.state={};self.break_event=False;self.points_new=True
    async def fetchrow(self,sql,*args):
        self.calls.append(('fetchrow',sql,args))
        if 'FROM grammar_exercises' in sql:return {'id':EID,'topic_id':TOPIC,'prompt_text':'Write a sentence','correct_option':'I have studied','explanation':'Present perfect'}
        if 'FROM grammar_topics' in sql:return {'id':TOPIC,'title':'present perfect','source_ref':None}
        if 'FROM content_versions' in sql:return None
        if 'INSERT INTO grammar_attempts' in sql:return {'id':ATTEMPT}
        if 'FROM speaking_attempts' in sql:return {'id':EID,'user_id':self.state.get('owner',UID),'prompt_id':TOPIC,'part':'part1','recording_duration_ms':45000}
        if 'FROM speaking_prompts' in sql:return {'prompt_text':'Tell me about your hobby'}
        if 'INSERT INTO vocabulary_usages' in sql:return {'id':ATTEMPT}
        if 'FROM user_vocabulary' in sql:
            return {'id':EID,'user_id':UID,'lexeme_id':LEXEME,'srs_stage':self.state.get('stage',2),'active_use_count':self.state.get('active',0),
                    'correct_count':3,'incorrect_count':0,'mastered_at':None}
        if 'FROM lexemes' in sql:return {'id':LEXEME,'term':'develop','definition_en':'grow or expand'}
        if 'INSERT INTO vocabulary_usages' in sql:return {'id':ATTEMPT}
        if 'FROM vocabulary_usages' in sql:return {'id':ATTEMPT,'user_id':UID,'user_vocabulary_id':EID,'sentence':'I develop better skills every day.', 'origin':'manual'}
        if 'INSERT INTO vocab_point_events' in sql:return {'id':ATTEMPT} if self.points_new else None
        raise AssertionError('Unexpected SQL:'+sql)
    async def execute(self,sql,*args):
        self.calls.append(('execute',sql,args))
        if self.break_event and 'ACTIVITY_EVENTS' in sql.upper():raise RuntimeError('transaction aborted')
        return 'OK'
    def transaction(self):return _Tx(self)

class _Tx:
    def __init__(self,conn):self.conn=conn
    async def __aenter__(self):self.conn.calls.append(('transaction_begin','',()));return self.conn
    async def __aexit__(self,*a):self.conn.calls.append(('transaction_end','',()));return False
class _Acquire:
    def __init__(self,conn):self.conn=conn
    async def __aenter__(self):return self.conn
    async def __aexit__(self,*a):return False
class Pool:
    def __init__(self,conn):self.conn=conn
    def acquire(self):return _Acquire(self.conn)

@pytest.fixture
def setup(monkeypatch):
    con=Conn()
    async def own(*a,**kw):return {'id':UID,'role':'student','account_status':'active','locale':'en'}
    async def db():return Pool(con)
    async def evalok(*args,**kw):
        con.calls.append(('evaluate','',args))
        return {'ok':True,'evaluation':{'id':str(ATTEMPT),'verdict':'correct','issues':[{'message':'Review article usage.'}]},'reused':False}
    monkeypatch.setattr(core,'current_user',own)
    monkeypatch.setattr(core,'pool',db)
    monkeypatch.setattr(coach,'evaluate',evalok)
    return con

ROUTES=('/api/grammar/exercises/'+str(EID)+'/produce','/api/speaking/attempts/'+str(EID)+'/transcript','/api/vocabulary/'+str(EID)+'/use')
BODIES=({'answer':'I have studied English.'},{'manualTranscript':'I have studied English for two years.'},{'sentence':'I develop better skills every day.'})

@pytest.mark.parametrize('path',ROUTES)
def test_non_uuid_path_does_not_query_db(monkeypatch,path):
    async def no_pool():raise AssertionError('invalid UUID reached DB')
    monkeypatch.setattr(core,'pool',no_pool)
    assert client.post(path.replace(str(EID),'bad'),json={}).status_code==404

@pytest.mark.parametrize('path',ROUTES)
def test_anonymous_does_not_query_db(monkeypatch,path):
    async def anon(*a,**kw):return None
    async def no_pool():raise AssertionError('unauthenticated query')
    monkeypatch.setattr(core,'current_user',anon);monkeypatch.setattr(core,'pool',no_pool)
    r=client.post(path,json={})
    assert r.status_code==401 and r.json()=={'error':'unauthenticated'}

@pytest.mark.parametrize('path',ROUTES)
def test_bad_body_does_not_write(setup,path):
    r=client.post(path,json={})
    assert r.status_code==400 and r.json()=={'error':'invalid_input'}
    assert not any('INSERT INTO' in sql for typ,sql,*_ in setup.calls if typ=='fetchrow')

@pytest.mark.parametrize('path',ROUTES)
def test_wrong_body_size_does_not_write(setup,path):
    key={'/api/grammar':'answer','/api/speaking':'manualTranscript','/api/vocabulary':'sentence'}[next(x for x in ('/api/grammar','/api/speaking','/api/vocabulary') if path.startswith(x))]
    for val in ('x' if key!='answer' else '', 'x'*10000):
        r=client.post(path,json={key:val})
        assert r.status_code==400


def test_produce_success_pins_user_and_joins_event(setup):
    r=client.post(ROUTES[0],json=BODIES[0])
    assert r.status_code==200 and r.json()=={'ok':True,'attemptId':str(ATTEMPT),'verdict':'correct',
         'checkedBy':'RIWI','sampleAnswer':'I have studied','explanation':'Present perfect','issues':['Review article usage.']}
    assert any('source_owner_user_id=$2 OR (source_owner_user_id IS NULL AND source_submission_id IS NULL)' in sql for kind,sql,*_ in setup.calls)
    assert any(kind=='transaction_begin' for kind,*_ in setup.calls)
    assert any('GRAMMAR_PRODUCTION_SUBMITTED' in sql for kind,sql,*_ in setup.calls)
    assert not any('DELETE FROM grammar_attempts' in sql for kind,sql,*_ in setup.calls)


def test_produce_evaluation_failure_compensated(setup,monkeypatch):
    async def fail(*a,**kw):return {'ok':False,'error':'external_required'}
    monkeypatch.setattr(coach,'evaluate',fail)
    r=client.post(ROUTES[0],json=BODIES[0])
    assert r.status_code==502 and r.json()=={'error':'external_required'}
    assert any('DELETE FROM grammar_attempts' in sql for kind,sql,*_ in setup.calls)
    assert not any('GRAMMAR_PRODUCTION_SUBMITTED' in sql for kind,sql,*_ in setup.calls)


def test_produce_rollback_compensated(setup):
    setup.break_event=True
    r=client.post(ROUTES[0],json=BODIES[0])
    assert r.status_code==500 and r.json()=={'error':'result_write_failed'}
    assert any('DELETE FROM grammar_attempts' in sql for kind,sql,*_ in setup.calls)


def test_speaking_not_owned_forbidden_without_evaluation(setup):
    setup.state['owner']=OTHER
    r=client.post(ROUTES[1],json=BODIES[1])
    assert r.status_code==403 and r.json()=={'error':'forbidden'}
    assert not any(kind=='evaluate' for kind,*_ in setup.calls)


def test_speaking_success_persists_explicit_manual_origin(setup):
    r=client.post(ROUTES[1],json=BODIES[1])
    assert r.status_code==200 and r.json()=={'ok':True,'evaluationId':str(ATTEMPT),'checkedBy':'RIWI','reused':False}
    sql=[(sql,args) for kind,sql,args in setup.calls if kind=='execute' and 'UPDATE speaking_attempts' in sql]
    assert len(sql)==1 and "transcript_origin='manual'" in sql[0][0] and 'transcript_provider=NULL' in sql[0][0]
    assert any(kind=='evaluate' and args[2]=='speaking_attempt' for kind,_,args in setup.calls if kind=='evaluate')


def test_speaking_failure_no_transcript_write(setup,monkeypatch):
    async def fail(*a,**kw):return {'ok':False,'error':'evaluation_unavailable'}
    monkeypatch.setattr(coach,'evaluate',fail)
    r=client.post(ROUTES[1],json=BODIES[1])
    assert r.status_code==502 and r.json()=={'error':'evaluation_unavailable'}
    assert not any('UPDATE speaking_attempts' in sql for kind,sql,*_ in setup.calls)


def test_vocab_confirm_one_transaction_awards_2_points(setup):
    r=client.post(ROUTES[2],json=BODIES[2])
    assert r.status_code==200 and r.json()=={'ok':True,'usageId':str(ATTEMPT),'verdict':'correct',
             'accepted':True,'checkedBy':'RIWI','mastery':'active','points':2}
    sql=[sql for kind,sql,*_ in setup.calls]
    assert any('ON CONFLICT(dedupe_key) DO NOTHING' in q for q in sql)
    assert any('VOCABULARY_USED' in q for q in sql)
    assert any('UPDATE user_vocabulary' in q for q in sql)
    assert any(kind=='transaction_begin' for kind,*_ in setup.calls)


def test_vocab_repeated_sentence_never_double_awards(setup):
    setup.points_new=False
    r=client.post(ROUTES[2],json=BODIES[2])
    assert r.status_code==200 and r.json()['points']==0
    assert not any('UPDATE user_vocabulary' in sql for kind,sql,*_ in setup.calls)


def test_vocab_provider_failure_keeps_unevaluated_sentence(setup,monkeypatch):
    async def fail(*a,**kw):return {'ok':False,'error':'evaluation_unavailable'}
    monkeypatch.setattr(coach,'evaluate',fail)
    r=client.post(ROUTES[2],json=BODIES[2])
    assert r.status_code==502 and r.json()=={'error':'evaluation_unavailable','usageId':str(ATTEMPT),'origin':'manual','accepted':False,'points':0}
    assert not any('DELETE FROM vocabulary_usages' in sql or 'UPDATE vocabulary_usages' in sql for kind,sql,*_ in setup.calls)


def test_vocab_wrong_result_keeps_mastery(setup,monkeypatch):
    async def fail(*a,**kw):return {'ok':True,'evaluation':{'id':str(ATTEMPT),'verdict':'needs_correction','issues':[]},'reused':False}
    monkeypatch.setattr(coach,'evaluate',fail)
    r=client.post(ROUTES[2],json=BODIES[2]);assert r.status_code==200
    assert r.json()['accepted'] is False and r.json()['points']==0 and r.json()['mastery']=='known'
    assert not any('INSERT INTO vocab_point_events' in sql for kind,sql,*_ in setup.calls)


def test_vocab_stage_four_mastered(setup):
    setup.state['stage']=4
    r=client.post(ROUTES[2],json=BODIES[2]);assert r.json()['mastery']=='mastered'


def test_hash_normalization_and_locale(setup):
    assert api._sentence_hash('HI,  There!')==api._sentence_hash('hi there')
    from starlette.requests import Request
    def request(cookie):return Request({'type':'http','headers':[(b'cookie',cookie.encode())]})
    assert api._language(request('la_locale=en'))=='en'
    assert api._language(request('la_locale=uz'))=='uz'
    assert api._language(request('la_locale=xx'))=='uz'


def test_riwi_outputs_have_native_schema():
    assert coach.valid(gval('Tell me about your plans','I am studying in Tashkent today.'))
    assert coach.valid(vval('improve','get better','I improve my English every day.'))
    assert coach.valid(sval('I usually study English every evening because I want to develop stronger skills.','part1'))
    assert vval('improve','get better','I improve my English every day.')['verdict']=='needs_correction' # source evaluator's suffix regex
    assert contains_form('I develop better skills every day.','develop')
    assert sval('I speak in long sentences to practise clearly.','part1')['criteria'][-1]['band'] is None


def test_three_new_routes_registered_once():
    required={('POST','/api/grammar/exercises/{id}/produce'),('POST','/api/speaking/attempts/{id}/transcript'),('POST','/api/vocabulary/{id}/use')}
    actual=[(m,r.path) for r in core.app.routes if r.path.startswith('/api/') for m in getattr(r,'methods',())]
    assert required<=set(actual) and len(actual)==len(set(actual))==340
