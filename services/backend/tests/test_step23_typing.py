"""Typing token/metrics invariants and API authentication; DB integration not implied."""
import os,time
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step23_typing import CORPUS,sign,verify,metrics,validate_finish,replay_keystrokes,PREP,RUN,TokenProblem
from app.step23_typing_legacy import result,levenshtein
client=TestClient(core.app)

@pytest.fixture(autouse=True)
def signing_secret(monkeypatch):monkeypatch.setenv('AUTH_SECRET','test-credential-is-long-enough-not-for-production')

def test_corpus_from_source():
    assert len(CORPUS)==30 and len({i['id'] for i in CORPUS})==30
    assert all(i['body'] and i['title'] for i in CORPUS)

def test_signed_token_subject_and_audience():
    t=sign({'tt':CORPUS[0]['id'],'ps':30},PREP,'owner')
    assert verify(t,PREP,'owner')['ps']==30
    assert verify(t,RUN,'owner') is None
    assert verify(t,PREP,'different') is None
    b=t.split('.'); b[1]='A'+b[1][1:]
    with pytest.raises(TokenProblem):verify('.'.join(b),PREP,'owner')

def test_token_expiry():
    now=1700000000000
    t=sign({'tt':CORPUS[0]['id']},PREP,'owner',now_ms=now,lifetime=1000)
    assert verify(t,PREP,'owner',now_ms=now)['tt']==CORPUS[0]['id']
    assert verify(t,PREP,'owner',now_ms=now+2000) is None

@pytest.mark.parametrize('words,allowed',[
    (['The','quick'],True), (['a b'],False), (['z'*81],False),
    (['word']*12,False)
])
def test_validate_finish(words,allowed):
    assert validate_finish(['The','quick','brown'],words,30) is allowed

def test_metrics_only_server_values():
    r=metrics(['The','quick','brown'],['The','quick','br'],30,[2,4,5,8])
    assert r['correct']==10 and r['missed']==0 and r['completion']>0
    assert r['rawWpm']>0 and r['wpm']>0

def test_keystroke_replay_detects_forgery():
    assert replay_keystrokes(['cat'],['cat'],['c','a','t'],0)['accuracy']==100
    assert replay_keystrokes(['cat'],['cat'],['p','a','t'],0) is None

def test_legacy_text_metrics():
    assert levenshtein('kitten','sitting')==3
    r=result('this is a test','this is',60000)
    assert r['typedChars']==7 and r['targetChars']==14
    assert r['completion']==50.0 and r['accuracy']==100
    with pytest.raises(ValueError):result('this','this',1000)

@pytest.mark.parametrize('endpoint',[
    '/api/writing/typing/prepare','/api/writing/typing/start',
    '/api/writing/typing/pause','/api/writing/typing/resume',
    '/api/writing/typing/finish','/api/writing/typing',
])
def test_anonymous_rejected_without_db(monkeypatch,endpoint):
    async def no_user(*args,**kwargs):return None
    async def no_db():raise AssertionError('should not connect')
    monkeypatch.setattr(core,'current_user',no_user)
    monkeypatch.setattr(core,'pool',no_db)
    assert client.post(endpoint,json={}).status_code==401

@pytest.mark.parametrize('preset',[0,30,60,120,180])
def test_timed_and_full_presets_pause_resume(monkeypatch,preset):
    async def signed_in(*args,**kwargs):return {'id':'owner'}
    monkeypatch.setattr(core,'current_user',signed_in)
    now=int(time.time()*1000)
    original=sign({'tt':CORPUS[0]['id'],'ps':preset,'st':now-3000,'pm':0,'pc':0},
                  RUN,'owner',now_ms=now,lifetime=720000,jti='test-run-id')
    paused=client.post('/api/writing/typing/pause',json={'runToken':original})
    assert paused.status_code==200
    payload=paused.json()
    assert payload['paused'] is True
    claims=verify(payload['runToken'],RUN,'owner')
    assert claims['ps']==preset and claims['pa']>=now and claims['pc']==1
    resumed=client.post('/api/writing/typing/resume',json={'runToken':payload['runToken']})
    assert resumed.status_code==200
    result=resumed.json()
    assert result['paused'] is False
    claims=verify(result['runToken'],RUN,'owner')
    assert claims['ps']==preset and claims['pc']==1 and 'pa' not in claims
    assert claims['pm']>=0
