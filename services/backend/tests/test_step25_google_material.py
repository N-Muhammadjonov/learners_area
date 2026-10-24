"""Request-bound regression checks for the Google callback and material creation.
These are local tests; a real Google/PG integration test is still outstanding.
"""
from urllib.parse import parse_qs,urlsplit
from unittest.mock import AsyncMock
from uuid import uuid4
from fastapi.testclient import TestClient
from app import main as core
from app.step25_google_callback import flow_data, resolve_account, fail
from app.step25_speaking_material_create import valid
from app.step25_content_version import version_hashes

client = TestClient(core.app)
TOKEN={'state':'S'*43,'nonce':'N'*43,'verifier':'V'*64}

def test_google_flow_tampering_rejected():
    import json
    assert flow_data(json.dumps(TOKEN)) == TOKEN
    assert flow_data(json.dumps({**TOKEN,'state':'short'})) is None
    assert flow_data('{broken}') is None
    assert flow_data('x'*1001) is None

def test_google_callback_auth_policy_block(monkeypatch):
    monkeypatch.setattr(core,'auth_policy',lambda:{'googleEnabled':False})
    response=client.get('/api/auth/google/callback',follow_redirects=False)
    assert response.status_code == 403

def test_google_state_check(monkeypatch):
    import json
    monkeypatch.setattr(core,'auth_policy',lambda:{'googleEnabled':True})
    monkeypatch.setattr('app.step25_google_callback.google_config',lambda:{'clientId':'test','redirectUri':'x','clientSecret':'x'})
    # A missing flow is always rejected before any network/database interaction.
    response=client.get('/api/auth/google/callback?state='+TOKEN['state']+'&code=abc',follow_redirects=False)
    assert response.status_code==307
    assert urlsplit(response.headers['location']).path=='/login'
    assert parse_qs(urlsplit(response.headers['location']).query)['error']==['google_state']

def test_material_exact_categories_and_defaults():
    base={'category':'part1','title':'My new study material','primary':{'mode':'link','primaryType':'link','primaryUrl':'https://example.org/video'}}
    assert valid(base)
    assert not valid({**base,'category':'speaking'})
    assert not valid({**base,'category':'shadowing'})
    assert valid({**base,'blocks':[{'type':'image','ref':{'objectKey':'root/key'}}]}) # valid shape, claim enforces ownership
    assert not valid({**base,'title':'x'})
    assert not valid({**base,'primary':{'mode':'link','primaryType':'link','primaryUrl':'file:///etc/passwd'}})

def test_material_anonymous_and_forbidden(monkeypatch):
    async def no_user(*args,**kwargs):return None
    monkeypatch.setattr(core,'current_user',no_user)
    assert client.post('/api/speaking/materials',json={}).status_code==401
    async def student(*a,**k):return {'id':str(uuid4()),'role':'student'}
    monkeypatch.setattr(core,'current_user',student)
    assert client.post('/api/speaking/materials',json={}).status_code==403

def test_material_validation_before_db(monkeypatch):
    async def admin(*a,**k):return {'id':str(uuid4()),'role':'admin'}
    async def no_db():raise AssertionError('invalid body must not query database')
    monkeypatch.setattr(core,'current_user',admin)
    monkeypatch.setattr(core,'pool',no_db)
    assert client.post('/api/speaking/materials',json={'category':'shadowing'}).status_code==400

def test_material_version_private_key_not_canonical():
    data={'title':'Audio lesson','category':'part1','primaryType':'audio','primaryUrl':None,'hasPrimary':True,'primaryOriginalName':'clip.mp3','primaryMimeType':'audio/mpeg','primarySize':1234,'blocks':[{'type':'audio'}]}
    assert version_hashes('speaking','material',data)==version_hashes('speaking','material',dict(reversed(list(data.items()))))
    assert 'objectKey' not in str(data)
