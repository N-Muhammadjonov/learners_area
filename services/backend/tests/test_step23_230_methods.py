"""API authorization and deterministic rules: these are not database integration tests."""
import json
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step23_grade import criteria,word_count
from app.step23_writing_provider import normalized_check,valid_evaluation
from app.step23_stealing_practice import near_copy
from app.step23_translation_answer import norm
from app.step23_activation_check import contains,custom,score,stats

client=TestClient(core.app)
NEW={('GET','/api/vocabulary/lookup'),('GET','/api/admin/content/versions/{id}/preview'),
('POST','/api/writing/typing/prepare'),('POST','/api/writing/typing/start'),('POST','/api/writing/typing/pause'),
('POST','/api/writing/typing/resume'),('POST','/api/writing/typing/finish'),('POST','/api/writing/typing'),
('POST','/api/writing/grade'),('POST','/api/writing/grade/{id}'),('POST','/api/writing/translation/{id}/answer'),
('POST','/api/writing/stealing/practice'),('POST','/api/writing/activation/check')}

def test_inventory_exact():
    state=json.loads(Path('PORT_STATUS.json').read_text())
    actual=[(m,r.path) for r in core.app.routes for m in getattr(r,'methods',()) if r.path.startswith('/api/')]
    found=set(actual)
    assert len(actual)==len(found)==345
    assert state['ported_methods']==345 and state['unported_methods']==0
    ported={(r['method'],r['path']) for r in state['endpoints'] if r['status'].startswith('ported_')}
    assert ported==found and NEW<=ported

@pytest.mark.parametrize('endpoint',[
 '/api/writing/grade','/api/writing/grade/'+str(uuid4()),'/api/writing/translation/'+str(uuid4())+'/answer',
 '/api/writing/stealing/practice','/api/writing/activation/check'])
def test_anonymous_denied_before_db(monkeypatch,endpoint):
    async def no_user(*a,**k):return None
    async def no_db():raise AssertionError('unauthenticated query')
    monkeypatch.setattr(core,'current_user',no_user)
    monkeypatch.setattr(core,'pool',no_db)
    r=client.post(endpoint,json={})
    assert r.status_code==401

@pytest.mark.parametrize('endpoint,payload',[
 ('/api/writing/grade',{'taskType':'task2','question':'x','essay':'yes','idempotencyKey':'bad'}),
 ('/api/writing/translation/'+str(uuid4())+'/answer',{'position':0,'answer':'hello'}),
 ('/api/writing/stealing/practice',{'patternId':'bad','newTopic':'health','answer':'message'}),
 ('/api/writing/activation/check',{'sessionId':'bad','mode':'writing','targetLevel':'7.0','uzbekPrompt':False,'answer':'text'})])
def test_invalid_input_no_db(monkeypatch,endpoint,payload):
    async def own(*a,**k):return {'id':uuid4(),'role':'student','locale':'en'}
    async def no_db():raise AssertionError('invalid body reached db')
    monkeypatch.setattr(core,'current_user',own);monkeypatch.setattr(core,'pool',no_db)
    assert client.post(endpoint,json=payload).status_code==400

def test_grade_four_criteria():
    arr=[{'key':x,'label':x,'band':v} for x,v in [('task_response',6.37),('coherence_cohesion',6.0),('lexical_resource',7),('grammatical_range_accuracy',7)]]
    overall,items=criteria('task2',arr)
    assert overall==6.5 and len(items)==4
    assert criteria('task2',arr+[arr[0]]) is None
    assert criteria('task1',arr) is not None
    assert word_count('hello  world\n test')==3

def test_near_copy_source_guard():
    assert near_copy('Technology changed education','Technology changed education','changed')['reason']=='exact'
    assert near_copy('Schools improved nature','Technology changed education','changed')['nearCopy'] is False

def test_translation_normalization():
    assert norm('“Hello” — world!')==norm('"hello" - world')

def test_activation_check_word_order_and_scoring():
    assert contains('She made a good decision','make a decision')
    assert not contains('decision tomorrow might make him','make a decision')
    assert contains('They mitigated the impact','mitigate')
    assert custom('  make   a decision  ')=='make a decision'
    assert custom('word_thing') is None
    assert score({k:9 for k in ('meaning','form','collocation','naturalness','grammar')})==100
    assert score({'meaning':9}) is None

def test_activity_stats_persisted_only():
    e=[{'term':'word','verdict':'correct','usageRecorded':True,'bands':{'grammar':8},'activationScore':80},
       {'term':'word','verdict':'needs_revision','usageRecorded':False,'bands':None,'activationScore':None}]
    out=stats(e)
    assert out['attempts']==2 and out['items']==1 and out['usageRecorded']==1

@pytest.mark.asyncio
async def test_external_gate_without_configuration(monkeypatch):
    from app import step23_writing_provider as p
    async def unusable():return None
    monkeypatch.setattr(p,'provider_spec',unusable)
    result,err=await p.evaluate('en','writing-check',{},'system')
    assert result is None and err=='unavailable'
