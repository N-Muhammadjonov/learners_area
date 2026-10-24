"""New 150 -> 170 port: route inventory and isolated security/data-contract checks.

These are *not* an end-to-end PostgreSQL or source differential test suite.
"""
from datetime import datetime, timezone, timedelta
from uuid import UUID
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step17_dictionary_read_port import normalize_search, pinned
from app.step17_mcq_port import view, correct_options, correct, selected
from app.step17_access_events_port import access_event_user_id
from app.step17_stealing_workflow_port import words, uses, validate, match_key
from app.step17_speaking_write_port import clean_html, draft
from app.step17_listening_course_port import read_work, course_status, combine, SPEC
from app.step17_listening_work_port import graded

ID='11111111-1111-4111-8111-111111111111'
QID='22222222-2222-4222-8222-222222222222'
C=TestClient(core.app)

class DB:
    def __init__(self): self.calls=[];self.row=None;self.rows=[];self.value=None
    async def __aenter__(self):return self
    async def __aexit__(self,*args):return False
    def transaction(self):return self
    async def fetchrow(self,sql,*args):self.calls.append(('row',sql,args));return self.row
    async def fetchval(self,sql,*args):self.calls.append(('val',sql,args));return self.value
    async def fetch(self,sql,*args):self.calls.append(('fetch',sql,args));return self.rows
    async def execute(self,sql,*args):self.calls.append(('execute',sql,args));return 'OK'
class Pool:
    def __init__(self,db):self.db=db
    def acquire(self):return self.db

@pytest.fixture
def mock_db(monkeypatch):
    db=DB()
    async def pool():return Pool(db)
    async def user(req,active=False):return {'id':UUID(ID),'role':'student','account_status':'active'}
    monkeypatch.setattr(core,'pool',pool)
    monkeypatch.setattr(core,'current_user',user)
    return db


def test_inventory_exact_190_and_route_uniqueness():
    status=json.loads(Path('PORT_STATUS.json').read_text())
    listed={(r['method'],r['path']) for r in status['endpoints'] if r['status']!='not_ported'}
    actual=[(method,r.path) for r in core.app.routes for method in getattr(r,'methods',[]) if r.path.startswith('/api')]
    assert len(actual)==len(set(actual))>=210
    assert listed==set(actual)
    assert status['total_methods']==265
    assert status['ported_methods']==len(actual) and status['unported_methods']==265-len(actual)

@pytest.mark.parametrize('method,path',[
 ('POST','/api/owner/transfer'),('POST','/api/speaking/prompts'),
 ('POST','/api/speaking/topics'),('DELETE','/api/speaking/topics'),
 ('GET','/api/dictionary/recent'),('GET','/api/dictionary/search'),
 ('GET','/api/listening/full/'+ID+'/progress'),('POST','/api/listening/full/'+ID+'/progress'),
 ('POST','/api/listening/full/'+ID+'/practice'),('POST','/api/listening/full/'+ID+'/activity'),
 ('GET','/api/listening/mcq/'+ID),('PATCH','/api/listening/mcq/'+ID),
 ('POST','/api/writing/stealing/sessions/'+ID)
])
def test_all_sensitive_routes_return_401_or_403_without_session(monkeypatch,method,path):
    async def no(req,active=False):return None
    async def deny():raise AssertionError('Database should not be used for anonymous requests')
    monkeypatch.setattr(core,'current_user',no)
    monkeypatch.setattr(core,'pool',deny)
    response=C.request(method,path,json={} if method in ('POST','PATCH','DELETE') else None)
    assert response.status_code in (401,403), (method,path,response.status_code,response.text)


def test_mcq_hidden_key_before_chosen():
    session={'id':UUID(ID),'stage':'committed','notes':'a'*4,'own_answer':'abc',
             'chosen_answer':None,'reasoning':None}
    question={'id':UUID(QID),'order':1,'question_text':'What?',
              'options':['A. Yes','B. No'],'type_code':'mcq_single',
              'correct_answer':'A','explanation':'The recording says yes.'}
    r=view(session,question)
    assert r['options'] is None and r['correctAnswer'] is None and r['explanation'] is None
    assert r['next']['to']=='revealed'
    session['stage']='revealed'
    r=view(session,question)
    assert r['options']==question['options'] and r['correctAnswer'] is None
    session['stage']='chosen';session['chosen_answer']='A. Yes'
    r=view(session,question)
    assert r['correctAnswer']=='A' and r['outcome']=='correct'


def test_mcq_multiple_choice_checks_server_key():
    options=['A) One','B) Two','C) Three']
    assert correct_options('["A","C"]',options,True)==['A) One','C) Three']
    assert correct('["C) Three","A) One"]','["A","C"]',options,True)
    assert not correct('["A) One"]','["A","C"]',options,True)
    assert selected('["X"]',options,True) is None


def test_vocabulary_dictionary_normalization_stable():
    assert normalize_search('  STRAIGHT—FORWARD  ')=='straight-forward'
    assert normalize_search('  İSTANBUL   ')  # no empty replacement

@pytest.mark.asyncio
async def test_dictionary_release_pin_denies_stale_release():
    from app.step17_dictionary_read_port import pinned
    con=DB();con.row={'active_release_id':'rel-v1-123','previous_release_id':'rel-v1-old'}
    assert await pinned(con,'rel-v1-123')=='rel-v1-123'
    with pytest.raises(ValueError, match='release_mismatch'):
        await pinned(con,'rel-v1-old')


def test_dictionary_search_rejects_invalid_direction(mock_db):
    r=C.get('/api/dictionary/search?direction=TEST')
    assert r.status_code==400 and r.json()=={'error':'invalid_input'}
    assert not mock_db.calls


def test_dictionary_entry_history_bad_id_rejected(mock_db):
    r=C.post('/api/dictionary/entries/not-a-uuid',json={'query':'hello','direction':'EN','releaseId':'x'})
    assert r.status_code==400 and not mock_db.calls


def test_speaking_html_removes_scripts_and_handlers():
    rendered=clean_html('<p onclick="alert(1)">Hello</p><script>bad()</script>')
    assert 'onclick' not in rendered and '<script' not in rendered
    assert 'Hello' in rendered


def test_speaking_prompt_rejects_unauthored_parts():
    assert draft({'part':'part4','topic':'IELTS','promptText':'talk'}) is None
    assert draft({'part':'part1','topic':'','promptText':'talk'}) is None
    assert draft({'part':'part1','topic':'IELTS','promptText':'talk','availableIn':['ai']}) is None


def test_speaking_admin_only(mock_db):
    for m,p in [('POST','/api/speaking/prompts'),('POST','/api/speaking/topics'),('DELETE','/api/speaking/topics')]:
        r=C.request(m,p,json={})
        assert r.status_code==403 and not mock_db.calls


def test_owner_transfer_forbidden_non_owner(mock_db):
    r=C.post('/api/owner/transfer',json={'email':'target@site.com','password':'secret','keepRole':'admin'})
    assert r.status_code==403 and not mock_db.calls


def test_stealing_steps_strict_shape():
    assert validate({'action':'read'})
    assert not validate({'action':'read','text':'anything'})
    assert not validate({'action':'analyse','patternIds':['not-a-uuid']})
    assert validate({'action':'compare','text':'example'})
    assert not validate({'action':'recall','patternId':ID,'attempt':44})


def test_stealing_patterns_not_matched_by_substring_only():
    assert uses('I took responsibility yesterday.','take responsibility')
    assert not uses('I bought the book.','take responsibility')
    assert match_key('The cat is here.')==match_key('cat is here')


def test_listening_attempt_create_rejects_bad_id_before_sql(mock_db):
    assert C.post('/api/listening/attempts',json={'testId':'invalid'}).status_code==400
    assert not mock_db.calls


def test_listening_full_start_bad_id_before_sql(mock_db):
    assert C.post('/api/listening/full/invalid/start').status_code==404
    assert not mock_db.calls


def test_listening_sandbox_invalid_id_before_sql(mock_db):
    assert C.get('/api/listening/full/invalid/sandbox').status_code==404
    assert not mock_db.calls


def test_listening_mcq_bad_id_does_not_open_session(mock_db):
    assert C.post('/api/listening/mcq',json={'questionId':'wrong'}).status_code==400
    assert C.get('/api/listening/mcq/bad').status_code==404
    assert C.patch('/api/listening/mcq/bad',json={'step':'notes'}).status_code==404
    assert not mock_db.calls


def test_listening_course_corrupt_state_resets():
    spec={'version':12,'activities':{'exam':{'units':[],'minimum':1}}}
    expected={'version':12,'exam':False,'retry':[],'units':{}}
    assert read_work({'la-course-progress-v1':'{}'},spec)==expected
    assert read_work({'la-course-progress-v1':'garbage'},spec)==expected
    assert not course_status(spec,expected)['complete']


def test_listening_course_activities_require_answers():
    spec={'activities':{'review':{'units':['x','y'],'minimum':2}}}
    work={'exam':False,'retry':[],'units':{}}
    with pytest.raises(ValueError,match='invalid_answers'):
        combine(spec,work,'review',{'unknown':'value'})
    changed=combine(spec,work,'review',{'x':'valid'})
    assert changed['units']['review']==['x']


def test_listening_practice_server_grading():
    pkg={'questions':[{'number':1,'key':'answer','alternatives':['alternate'], 'pair':[]},
                      {'number':2,'key':'blue','alternatives':[],'pair':[]}]}
    result=graded(pkg,{'1':'ALTERNATE','2':'wrong'})
    assert result==[{'number':1,'correct':True},{'number':2,'correct':False}]


def test_auth_event_only_for_valid_ids():
    assert access_event_user_id(json.dumps({'userId':ID}))==ID
    assert access_event_user_id(json.dumps({'userId':'not-a-uuid'})) is None
    assert access_event_user_id('invalid') is None
    assert access_event_user_id('x'*257) is None
