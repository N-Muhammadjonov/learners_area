"""Checkpoint schema and stale-state gate, independent of external DB."""
import json
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step27_listening_authored_write import validate,parse_state,BadAnswers


def test_checkpoint_bounded_schema():
    assert validate({})
    assert validate({'my-key':'{}'})
    assert not validate(['bad'])
    assert not validate({'x':14})
    assert not validate({'x'*101:'ok'})
    assert not validate({'x':'y'*100001})


def test_canonical_state_validation():
    assert parse_state({'k':json.dumps({'answers':{'1':'yes','40':'no'},'attemptStatus':'submitted','audioPosition':0})},'k')['answers']['40']=='no'
    for malformed in ({'answers':{'41':'bad'}},{'answers':{'a':'x'}},{'attemptStatus':'done'},
                      {'audioPosition':-1},{'audioPosition':'0'},{'attemptKey':'not-a-uuid'}):
        with pytest.raises(BadAnswers):parse_state({'k':json.dumps(malformed)},'k')


def test_anonymous_save_refused_without_db(monkeypatch):
    async def none(*a,**k):return None
    async def no_pool():raise AssertionError('auth must precede DB')
    monkeypatch.setattr(core,'current_user',none)
    monkeypatch.setattr(core,'pool',no_pool)
    r=TestClient(core.app).put('/api/listening/full/e44e3d4b-3af6-41a9-b465-7d4bc21e1019/authored-state',json={})
    assert r.status_code==401
    assert r.json()=={'error':'unauthenticated'}
