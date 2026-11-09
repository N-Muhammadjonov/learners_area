"""Regression checks for new route gates and deterministic rule branches.
Not PostgreSQL integration or a live Next.js differential suite.
"""
import json
from pathlib import Path
from uuid import UUID
from fastapi.testclient import TestClient
import pytest
from app import main as core
from app.step26_listening_convert import scan
from app.step26_dictionary_discard import discard_dictionary_draft
from app.step26_owner_transfer import denial

client=TestClient(core.app)
UID='11111111-1111-4111-8111-111111111111'
NEW={
 ('POST','/api/internal/telegram/owner/handover'),
 ('POST','/api/internal/telegram/owner/transfer'),
 ('GET','/api/admin/listening/tests/{id}/convert'),
 ('GET','/api/owner/dictionary/{action:path}'),
 ('DELETE','/api/owner/dictionary/{action:path}'),
}

def test_inventory_actual_strict_250():
    report=json.loads(Path('PORT_STATUS.json').read_text())
    actual=[(m,r.path) for r in core.app.routes if r.path.startswith('/api/') for m in getattr(r,'methods',())]
    expected={(e['method'],e['path']) for e in report['endpoints'] if e['status'].startswith('ported_')}
    assert len(actual)==len(set(actual))==345
    assert set(actual)==expected and NEW<=expected
    assert report['ported_methods']==345 and report['unported_methods']==0
    assert report['total_methods']==345 and len(report['endpoints'])==345

@pytest.mark.parametrize('method,uri',[
 ('POST','/api/internal/telegram/owner/handover'),
 ('POST','/api/internal/telegram/owner/transfer'),
])
def test_bot_callbacks_reject_unauthorized_before_db(monkeypatch,method,uri):
    async def no_pool():raise AssertionError('anonymous bot request reached database')
    monkeypatch.setattr(core,'pool',no_pool)
    r=client.request(method,uri,json={'action':'start','actorTelegramId':'123456'})
    assert r.status_code in (401,500)  # missing secret generates configuration error
    assert 'error' in r.json()

@pytest.mark.parametrize('method,uri',[
 ('GET','/api/owner/dictionary/summary'),
 ('GET','/api/owner/dictionary/entries/'+UID),
 ('DELETE','/api/owner/dictionary/drafts/'+UID),
 ('GET','/api/admin/listening/tests/'+UID+'/convert'),
])
def test_user_auth_must_precede_storage(monkeypatch,method,uri):
    async def no_user(*a,**k):return None
    async def no_pool():raise AssertionError('unauthorized API hit database')
    monkeypatch.setattr(core,'current_user',no_user)
    monkeypatch.setattr(core,'pool',no_pool)
    r=client.request(method,uri)
    assert r.status_code in (401,403)

@pytest.mark.parametrize('method,uri',[
 ('GET','/api/owner/dictionary/summary'),
 ('DELETE','/api/owner/dictionary/drafts/'+UID),
])
def test_student_cannot_access_dictionary_owner(monkeypatch,method,uri):
    async def student(*a,**k):return {'id':UUID(UID),'role':'student','account_status':'active'}
    async def no_pool():raise AssertionError('unauthorized API hit database')
    monkeypatch.setattr(core,'current_user',student)
    monkeypatch.setattr(core,'pool',no_pool)
    r=client.request(method,uri)
    assert r.status_code==403 and r.json()=={'error':'forbidden'}

def test_owner_unknown_dictionary_route_does_not_open_db(monkeypatch):
    async def owner(*a,**k):return {'id':UUID(UID),'role':'owner','account_status':'active'}
    async def no_pool():raise AssertionError('unknown operation must not query database')
    monkeypatch.setattr(core,'current_user',owner)
    monkeypatch.setattr(core,'pool',no_pool)
    for method,uri in [('GET','/api/owner/dictionary/arbitrary'),('DELETE','/api/owner/dictionary/drafts/not-a-uuid')]:
        r=client.request(method,uri)
        assert r.status_code==404

def test_converter_classification_preserves_original_metadata_fields():
    pkg={'schemaVersion':1,'category':'full','testId':'abc','title':'Exam',
         'audio':{'path':'audio.mp3','durationSec':100},'imagePath':None,
         'keyword1':[],'keyword2':[],'vocabulary':[],
         'questions':[{'number':1}],
         'sections':[{'transcript':' test'}, {'transcript':' '} ]}
    r=scan(pkg)
    assert r['classification']=='CANONICAL_NATIVE'
    assert r['hasAuthoredRuntime'] is False and r['questions']==1
    assert r['sections']==2 and r['transcripts']==1 and r['runtimeFiles']==[]
    pkg['authoredRuntime']={'files':{'index.html':'<div></div>'},'entryPath':'index.html'}
    r=scan(pkg)
    assert r['classification']=='CONVERTIBLE_LEGACY'
    assert r['runtimeFiles']==['index.html'] and r['hasAuthoredRuntime'] is True
    pkg['authoredRuntime']['entryPath']='missing.html'
    r=scan(pkg)
    assert r['classification']=='LEGACY_REQUIRES_REVIEW'
    assert len(r['reasons'])==2

def test_owner_callback_denial_status():
    assert denial('not_found').status_code==404
    assert denial('wrong_actor').status_code==403
    assert denial('replay').status_code==409
