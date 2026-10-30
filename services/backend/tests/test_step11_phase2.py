"""HTTP contract tests for distinct new endpoints — no real secrets/DB writes."""
import os
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from test_migration_phase2 import FakePool
C=TestClient(core.app)
U=UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
P='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
class DB:
 def __init__(self):self.calls=[];self.row=None
 async def __aenter__(self):return self
 async def __aexit__(self,*args):return False
 async def execute(self,q,*args):self.calls.append(('execute',q,args))
 async def fetchval(self,q,*args):self.calls.append(('fetchval',q,args));return None
 async def fetchrow(self,q,*args):self.calls.append(('fetchrow',q,args));return self.row

def setup(monkeypatch,db=None,role='student'):
 db=db or DB()
 async def user(req,active=False):return {'id':U,'role':role,'account_status':'active'} if role else None
 async def pool():return FakePool(db)
 monkeypatch.setattr(core,'current_user',user);monkeypatch.setattr(core,'pool',pool)
 return db

def test_writing_submissions_unauth_validation_and_owner_scoped_update(monkeypatch):
 setup(monkeypatch,role=None)
 assert C.post('/api/writing/submissions',json={'promptId':P}).status_code==401
 db=setup(monkeypatch)
 assert C.post('/api/writing/submissions',json={'promptId':'bad'}).status_code==400
 assert C.patch('/api/writing/submissions/bad',json={'content':'hi'}).status_code==404
 assert C.patch('/api/writing/submissions/'+P,json={'content':None}).status_code==400
 assert C.patch('/api/writing/submissions/'+P,json={'content':'A B'}).status_code==404
 assert db.calls[-1][2][1]==U

def test_ai_control_owner_only_validation_and_metadata(monkeypatch):
 setup(monkeypatch)
 assert C.get('/api/owner/ai-control').status_code==403
 assert C.post('/api/owner/ai-control',json={}).status_code==403
 db=setup(monkeypatch,role='owner')
 assert C.post('/api/owner/ai-control',json={'externalEnabled':'yes','providerId':None}).status_code==400
 assert C.post('/api/owner/ai-control',json={'externalEnabled':True,'providerId':'unknown-service'}).json()['error']['code']=='unknown_provider'
 assert C.post('/api/owner/ai-control',json={'externalEnabled':True,'providerId':'riwi','model':'model'}).json()['error']['code']=='invalid_model'
 r=C.post('/api/owner/ai-control',json={'externalEnabled':False,'providerId':None})
 assert r.status_code==200
 assert r.json()['owner']['source']=='default'
 assert db.calls[0][0]=='execute' and 'ai.control.set' in db.calls[0][1]
 assert 'AI_PRIMARY_PROVIDER' not in str(r.json()['providers'])

def test_content_registries_staff_permissions(monkeypatch):
 setup(monkeypatch,role=None)
 assert C.get('/api/admin/content/previews').status_code==401
 setup(monkeypatch)
 assert C.get('/api/admin/content/previews').status_code==403
 setup(monkeypatch,role='teacher')
 r=C.get('/api/admin/content/previews')
 assert r.status_code==200 and len(r.json()['items'])==17
 assert not r.json()['missing']
 r=C.get('/api/admin/content/authoring-capabilities')
 assert r.status_code==200 and r.json()['mayPublish'] is False
 assert 'speaking:material' in r.json()['authorableKeys']
 assert 'writing:task1' not in r.json()['authorableKeys']
 setup(monkeypatch,role='owner')
 r=C.get('/api/admin/content/authoring-capabilities')
 assert r.json()['mayPublish'] is True and len(r.json()['authorableKeys'])==17

def test_google_auth_start_redirect_and_secure_cookie(monkeypatch):
 monkeypatch.setattr(core,'auth_policy',lambda:{'googleEnabled':True})
 for k in ('GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','PUBLIC_BASE_URL'):
  monkeypatch.delenv(k,raising=False)
 r=C.get('/api/auth/google/start',follow_redirects=False)
 assert r.status_code==307 and r.headers['location'].endswith('/login?error=google_unavailable')
 monkeypatch.setenv('GOOGLE_CLIENT_ID','example.apps.googleusercontent.com')
 monkeypatch.setenv('GOOGLE_CLIENT_SECRET','abcdefghijklmnopqrst')
 monkeypatch.setenv('GOOGLE_REDIRECT_URI','https://learners.test/api/auth/google/callback')
 r=C.get('/api/auth/google/start',follow_redirects=False)
 assert r.status_code==307 and r.headers['location'].startswith('https://accounts.google.com/')
 assert 'HttpOnly' in r.headers['set-cookie'] and 'la_google_flow' in r.headers['set-cookie']

def test_telegram_updates_bearer_and_idempotent(monkeypatch):
 db=setup(monkeypatch)
 monkeypatch.setenv('BOT_SERVICE_SECRET','validbotsecret')
 assert C.post('/api/internal/telegram/updates',json={'updateId':'123'}).status_code==401
 h={'Authorization':'Bearer validbotsecret'}
 assert C.post('/api/internal/telegram/updates',json={'updateId':'x'},headers=h).status_code==400
 assert C.post('/api/internal/telegram/updates',json={'updateId':'123'},headers=h).json()=={'fresh':False}
 assert db.calls[-1][2]==('123',)

def test_telegram_contact_phone_owner_guard(monkeypatch):
 db=setup(monkeypatch)
 monkeypatch.setenv('BOT_SERVICE_SECRET','validbotsecret')
 h={'Authorization':'Bearer validbotsecret'}
 assert C.post('/api/internal/telegram/contacts/phone',json={'telegramUserId':'123','contactUserId':'456'},headers=h).status_code==403
 assert C.post('/api/internal/telegram/contacts/phone',json={'telegramUserId':'123','contactUserId':'123','phoneNumber':'bad'},headers=h).status_code==400
 assert C.post('/api/internal/telegram/contacts/phone',json={'telegramUserId':'123','contactUserId':'123','phoneNumber':'901234567'},headers=h).status_code==409
 assert db.calls[-1][2]==('123','+901234567')

def test_telegram_readiness_schema_and_secret(monkeypatch):
 db=setup(monkeypatch)
 monkeypatch.setenv('BOT_SERVICE_SECRET','validbotsecret')
 h={'Authorization':'Bearer validbotsecret'}
 r=C.get('/api/internal/telegram/ready',headers=h)
 assert r.status_code==503 and r.json()=={'ok':False}
 monkeypatch.setenv('AUTH_SECRET','abcdefghijklmnop')
 monkeypatch.setenv('TELEGRAM_BOT_TOKEN','bot')
 monkeypatch.setenv('TELEGRAM_BOT_USERNAME','learner')
 r=C.get('/api/internal/telegram/ready',headers=h)
 assert r.status_code==503 and len([q for typ,q,_ in db.calls if typ=='execute'])==7

def test_dictionary_recent_delete_own_only(monkeypatch):
 db=setup(monkeypatch,role=None)
 assert C.delete('/api/dictionary/recent').status_code==401
 db=setup(monkeypatch)
 r=C.delete('/api/dictionary/recent')
 assert r.status_code==200 and r.json()=={'ok':True}
 assert db.calls==[('execute', 'DELETE FROM dictionary_recent_searches WHERE user_id=$1',(U,))]
