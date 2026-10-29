"""190-method checkpoint: isolated authorization, storage, privacy, SQL and wire-format tests.

No live PostgreSQL/S3/Telegram/Worker tests run here; they remain a parity gap.
"""
from __future__ import annotations
import json, hashlib, hmac, time, sys
from datetime import datetime,timezone,timedelta
from pathlib import Path
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step20_media_port import (create_capability,verify_capability,media_range,safe_media_key,
    media_url,allow_resource,media_conf)
from app.step20_upload_finalize_port import (signature,mime_match)
from app.step20_retention_transitions_port import (phase,word_count,learner_payload)
from app.step20_lesson_editor_port import from_snapshot,from_row
from app.step19_vocab_games_port import normalize,input_valid
from app.step18_telegram_auth_port import telegram_verified

ID=UUID('11111111-1111-4111-8111-111111111111')
RID=UUID('22222222-2222-4222-8222-222222222222')
VID=UUID('33333333-3333-4333-8333-333333333333')
now=datetime.now(timezone.utc)
C=TestClient(core.app)

class DB:
    def __init__(self):self.calls=[];self.rows=[];self.data={};self.fetchrow_return=None
    async def __aenter__(self):return self
    async def __aexit__(self,*a):return False
    def transaction(self):return self
    async def fetchrow(self,sql,*a):
        self.calls.append(('row',sql,a));
        if 'FROM upload_intents' in sql:return self.data.get('upload')
        if 'FROM lessons' in sql:return self.data.get('lesson')
        if 'FROM retention_attempts' in sql:return self.data.get('retention')
        if sql.startswith('UPDATE retention_attempts'):return self.data.get('updated') or self.data.get('retention')
        if 'FROM speaking_materials' in sql:return self.data.get('material')
        if 'FROM material_blocks' in sql:return self.data.get('material_block')
        if 'FROM resource_blocks' in sql:return self.data.get('resource_block')
        if 'FROM speaking_attempts' in sql:return self.data.get('speaking')
        if 'FROM listening_packages' in sql:return self.data.get('listening')
        return self.fetchrow_return
    async def fetch(self,sql,*a):
        self.calls.append(('fetch',sql,a))
        if 'FROM content_versions' in sql:return self.data.get('versions',[])
        if 'FROM lesson_blocks' in sql:return self.data.get('blocks',[])
        return self.rows
    async def execute(self,sql,*a):self.calls.append(('execute',sql,a));return 'UPDATE 1'
    async def fetchval(self,sql,*a):self.calls.append(('val',sql,a));return self.data.get('value')
class Pool:
    def __init__(self,db):self.db=db
    def acquire(self):return self.db

@pytest.fixture
def env(monkeypatch):
    # Collection and unrelated tests can outlast the 45-second recall fixture.
    monkeypatch.setattr(sys.modules[__name__],'now',datetime.now(timezone.utc))
    db=DB()
    async def pool():return Pool(db)
    async def user(req,active=False):return {'id':ID,'role':'student','account_status':'active'}
    async def authority(req):return {'user':{'id':ID,'role':'student','account_status':'active'},'sessionKey':'a'*64,'authVersion':0,'expiresAt':int(time.time())+300}
    monkeypatch.setattr(core,'pool',pool)
    monkeypatch.setattr(core,'current_user',user)
    monkeypatch.setattr(core,'current_authority',authority)
    monkeypatch.delenv('MEDIA_WORKER_URL',raising=False)
    monkeypatch.delenv('MEDIA_SIGNING_SECRET',raising=False)
    return db


def test_inventory_reconciled_and_no_undeclared_route():
    d=json.loads(Path('PORT_STATUS.json').read_text())
    registered=[(method,route.path) for route in core.app.routes for method in route.methods if route.path.startswith('/api/')]
    declared={(v['method'],v['path']) for v in d['endpoints'] if v['status'].startswith('ported_')}
    assert len(registered)==len(set(registered))>=210
    assert declared==set(registered)
    assert len(d['endpoints'])==274 and d['ported_methods']==len(registered) and d['unported_methods']==274-len(registered)

@pytest.mark.parametrize('method,path',[
  ('GET','/api/admin/content/lessons/'+str(RID)+'/edit'),
  ('GET','/api/resources/private/demo.txt'),('HEAD','/api/resources/private/demo.txt'),
  ('POST','/api/uploads/finalize'),
  ('PATCH','/api/retention/attempts/'+str(RID)+'/draft'),
  ('POST','/api/retention/attempts/'+str(RID)+'/finish-reading'),
  ('GET','/api/vocabulary/games'),('POST','/api/vocabulary/games'),
  ('POST','/api/vocabulary/'+str(RID)+'/review'),
])
def test_new_private_routes_require_auth(monkeypatch,method,path):
    async def nothing(req,active=False):return None
    monkeypatch.setattr(core,'current_user',nothing)
    monkeypatch.setattr(core,'current_authority',nothing)
    r=C.request(method,path,json={} if method in ('POST','PATCH','DELETE') else None)
    assert r.status_code==401,(method,path,r.text)

def test_media_key_rejects_traversal_and_controls():
    for val in ('../config','a//b','_private','a/./b','a/../b','a\\b','a?b',''):
        assert not safe_media_key(val)
    assert safe_media_key('pending/123/lecture-audio.mp3')

@pytest.mark.parametrize('raw,size,want',[
 ('bytes=0-9',100,(0,9)),('bytes=90-',100,(90,99)),('bytes=-10',100,(90,99)),
 ('bytes=0-999',100,(0,99)),('bytes=1-0',100,None),('bytes=100-101',100,None),
 ('bytes=0-1,2-3',100,None),('bytes=-0',100,None),('wrong=0-1',100,None),
])
def test_byte_ranges_match_typescript(raw,size,want):assert media_range(raw,size)==want

def test_media_capability_verifies_canonical_bytes_and_scope():
    secret='Z'*40
    token,claims=create_capability(secret,str(ID),3,'a'*64,int(time.time())+240,'audio/p.mp3')
    assert verify_capability(secret,token,'audio/p.mp3')==claims
    assert not verify_capability(secret,token,'audio/other.mp3')
    assert not verify_capability(secret,token+'a','audio/p.mp3')
    assert not verify_capability(secret[:-1]+'X',token,'audio/p.mp3')
    assert media_url('audio/p.mp3',token).startswith('https://learnersarea-media.owneruchunla.workers.dev/v1/media/')


def test_media_config_rejects_unapproved_origin(monkeypatch):
    monkeypatch.setenv('MEDIA_WORKER_URL','https://attacker.example/')
    monkeypatch.setenv('MEDIA_SIGNING_SECRET','z'*40)
    with pytest.raises(ValueError):media_conf()

def test_media_backchannel_rejects_absent_or_malformed_configuration(env):
    assert C.post('/api/media/authorize',json={'allowed':True}).status_code==403

def test_resource_unauthorized_key_disclosure_denied(env):
    assert C.get('/api/resources/../abc').status_code in (400,404)
    assert C.get('/api/resources/valid/file.pdf').status_code==404

def test_resource_private_speaking_attempt_enforces_student_owner(env):
    env.data['speaking']={'user_id':RID}
    assert C.get('/api/resources/audio/attempt.webm').status_code==403
    assert C.head('/api/resources/audio/attempt.webm').status_code==403
    assert any('speaking_attempts' in call[1] for call in env.calls)

def test_resource_key_does_not_trust_browser_media_url(env):
    r=C.get('/api/resources/random/video.mp4?capability=1')
    assert r.status_code==404 and r.json()=={'error':'not_found'}

@pytest.mark.parametrize('content,extension,expected',[
 (b'MZ-Windows-data','file.pdf','executable'),
 (b'%PDF-1.7 x','file.pdf',None),
 (b'PK\x03\x04 x','file.zip',None),
 (b'<script>alert(1)</script>','notes.html',None),
 (b'\x00hello','notes.html','mismatch'),
 (b'PK\x03\x04 x','file.pdf','mismatch'),
 (b'','file.pdf','mismatch'),
])
def test_server_upload_magic_bytes(content,extension,expected):
    assert signature(extension,content)==expected

def test_storage_mime_comparison_tolerates_octet_stream():
    assert mime_match('application/octet-stream','image/png')
    assert mime_match('audio/mpeg; charset=binary','audio/mpeg')
    assert not mime_match('image/png','video/mp4')

def upload(overrides=None):
    return {'id':RID,'user_id':ID,'status':'pending','expires_at':now+timedelta(minutes=10),
     'object_key':'private/notes.pdf','original_name':'notes.pdf','mime_type':'application/pdf','size':24,
     **(overrides or {})}

def test_finalize_refuses_foreign_upload(env):
    env.data['upload']=upload({'user_id':VID})
    r=C.post('/api/uploads/finalize',json={'uploadId':str(RID)})
    assert r.status_code==404 and r.json()['code']=='not_found'
    assert not any(x[0]=='execute' for x in env.calls)

def test_finalize_refuses_expired_upload(env):
    env.data['upload']=upload({'expires_at':now-timedelta(hours=1)})
    r=C.post('/api/uploads/finalize',json={'uploadId':str(RID)})
    assert r.status_code==410 and r.json()['code']=='intent_expired'

def test_finalize_already_finalized_is_idempotent(env):
    env.data['upload']=upload({'status':'finalized'})
    r=C.post('/api/uploads/finalize',json={'uploadId':str(RID)})
    assert r.status_code==200 and r.json()['ok']
    assert not any(x[0]=='execute' for x in env.calls)

def test_upload_invalid_id_has_stable_error(env):
    r=C.post('/api/uploads/finalize',json={'uploadId':'not-a-uuid'})
    assert r.status_code==400 and r.json()['error']=='invalid_upload_id'

def test_lesson_edit_requires_staff(env):
    r=C.get('/api/admin/content/lessons/'+str(RID)+'/edit')
    assert r.status_code==403
    assert not env.calls

def test_lesson_editor_pulls_draft_not_published_row(monkeypatch,env):
    async def staff(req,active=False):return {'id':ID,'role':'teacher','account_status':'active'}
    monkeypatch.setattr(core,'current_user',staff)
    env.data['lesson']={'id':RID,'title':'Published title','slug':'published','unit_id':VID,'source_ref':'lesson-1',
       'learning_area':None,'summary':'summary','teacher_notes':None,'estimated_minutes':20,
       'publication_state':'published','publish_at':None}
    env.data['versions']=[{'id':VID,'title':'Draft title','version_no':2,'status':'draft','publication_state':'draft',
       'content_snapshot':{'title':'Draft title','learningArea':'listening','summary':'new','estimatedMinutes':12,
       'blocks':[{'type':'quiz','quiz':{'questionType':'mcq_single','prompt':'Q','answer':'correct'}}]}}]
    data=C.get('/api/admin/content/lessons/'+str(RID)+'/edit').json()['lesson']
    assert data['contentSource']=='draft'
    assert data['title']=='Draft title'
    assert data['learningArea']=='listening'
    assert data['blocks'][0]['quiz']['answer']=='correct'
    assert data['summary']=='new' and data['estimatedMinutes']==12
    assert data['pastRevisions']==1 and data['live'] is True

def test_lesson_snapshot_default_question_type():
    assert from_snapshot({'type':'quiz','quiz':{}})['quiz']['questionType']=='mcq_single'

def recall_row(overrides=None):
    return {'id':RID,'user_id':ID,'level':'B2','status':'recall',
       'retention_text_version_id':VID,'retention_text_id':VID,'retention_label_snapshot':'B2-101',
       'read_started_at':now-timedelta(minutes=4),'read_ends_at':now-timedelta(minutes=2),
       'write_started_at':now-timedelta(minutes=2),'write_ends_at':now+timedelta(seconds=45),
       'recall_text':'original','score':None,'score_breakdown':None,'evaluator_version':None,
       'submitted_at':None,'completed_at':None,**(overrides or {})}

def test_retention_recalls_do_not_leak_source(env):
    env.data['retention']=recall_row()
    r=C.post('/api/retention/attempts/'+str(RID)+'/finish-reading')
    assert r.status_code==200 and r.json()['phase']=='recall'
    assert r.json()['idempotent'] is True
    assert 'bodyText' not in r.json() and 'scoringStructure' not in r.json()
    assert not any(x[0]=='execute' for x in env.calls)

def test_retention_early_finish_moves_deadline_to_server_now(env):
    env.data['retention']=recall_row({'status':'reading','read_ends_at':now+timedelta(seconds=50),
          'write_ends_at':now+timedelta(minutes=4)})
    env.data['updated']=recall_row()
    r=C.post('/api/retention/attempts/'+str(RID)+'/finish-reading')
    assert r.status_code==200 and r.json()['idempotent'] is False
    updates=[x for x in env.calls if 'UPDATE retention_attempts' in x[1]]
    assert updates and updates[0][2][2]-updates[0][2][1]==timedelta(seconds=180)

def test_retention_late_autosave_refused(env):
    env.data['retention']=recall_row({'write_ends_at':now-timedelta(seconds=1)})
    r=C.patch('/api/retention/attempts/'+str(RID)+'/draft',json={'recallText':'late'})
    assert r.status_code==409 and r.json()['error']=='retention_wrong_phase'
    assert not any('UPDATE retention_attempts' in x[1] for x in env.calls)

def test_retention_invalid_autosave_length_rejected(env):
    r=C.patch('/api/retention/attempts/'+str(RID)+'/draft',json={'recallText':'a'*6001})
    assert r.status_code==400 and r.json()['error']=='retention_invalid_input'
    assert not env.calls

def test_retention_owned_recall_draft_saves(env):
    env.data['retention']=recall_row()
    r=C.patch('/api/retention/attempts/'+str(RID)+'/draft',json={'recallText':'My memory'})
    assert r.status_code==200 and r.json()['characterCount']==9
    assert any('UPDATE retention_attempts' in x[1] for x in env.calls)

def test_retention_word_count_nfkc_apostrophe():
    assert word_count("don't well-known 50,000") == 3
    assert word_count('')==0

def test_vocab_games_invalid_untrusted_submissions():
    assert not input_valid({'entryId':str(RID),'set':'due','gameId':'cards',
           'submission':{'kind':'self','known':'true'}})
    assert normalize("Learning's state-of-the-art") == "learning's state of the art"

def test_telegram_callback_signature_requires_verified_hmac(monkeypatch):
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN','123:telegram-secret')
    p={'id':'12345678','auth_date':str(int(time.time())),'first_name':'User'}
    key=hashlib.sha256(b'123:telegram-secret').digest()
    signed=hmac.new(key,'\n'.join(f'{k}={p[k]}' for k in sorted(p)).encode(),hashlib.sha256).hexdigest()
    assert telegram_verified({**p,'hash':signed})
    assert not telegram_verified({**p,'hash':'0'*64})

def test_upload_finalize_confirms_storage_and_commits_once(monkeypatch,env):
    import app.step20_upload_finalize_port as upload_port
    contents=b'%PDF-1.7\nexample document'
    env.data['upload']=upload({'size':len(contents)})
    env.fetchrow_return={'id':RID}
    async def head(key):
        assert key=='private/notes.pdf'
        return {'contentType':'application/pdf','size':len(contents)}
    async def read(key,start,end):
        assert (key,start,end)==('private/notes.pdf',0,len(contents)-1)
        return contents
    monkeypatch.setattr(upload_port,'head_object',head)
    monkeypatch.setattr(upload_port,'read_object',read)
    res=C.post('/api/uploads/finalize',json={'uploadId':str(RID)})
    assert res.status_code==200 and res.json()['ok']
    assert any('UPDATE upload_intents' in q[1] and "status='finalized'" in q[1] for q in env.calls)


def test_upload_finalize_refuses_inconsistent_storage_size(monkeypatch,env):
    import app.step20_upload_finalize_port as upload_port
    env.data['upload']=upload({'size':240})
    async def head(key):return {'contentType':'application/pdf','size':100}
    monkeypatch.setattr(upload_port,'head_object',head)
    res=C.post('/api/uploads/finalize',json={'uploadId':str(RID)})
    assert res.status_code==409 and res.json()['code']=='size_mismatch'
    assert not any('UPDATE upload_intents' in q[1] for q in env.calls)

@pytest.mark.parametrize('role,creator,expected', [
    ('admin',VID,200), ('owner',VID,200), ('teacher',ID,200),
    ('teacher',VID,403), ('student',ID,403),
])
def test_inactive_speaking_file_read_follows_original_content_ownership(env,monkeypatch,role,creator,expected):
    import app.step20_media_port as media_port
    async def authority(req):
        return {'user':{'id':ID,'role':role,'account_status':'active'},
                'sessionKey':'a'*64,'authVersion':0,'expiresAt':int(time.time())+300}
    async def local_head(key):return {'size':5,'contentType':'audio/mpeg'}
    async def local_stream(req,key,info,headers,span,head):
        from starlette.responses import Response
        return Response(b'hello',headers=headers)
    monkeypatch.setattr(core,'current_authority',authority)
    monkeypatch.setattr(media_port,'head_object',local_head)
    monkeypatch.setattr(media_port,'object_response',local_stream)
    env.data['material_block']={'material_id':RID}
    env.data['material']={'id':RID,'is_active':False,'created_by_user_id':creator}
    response=C.get('/api/resources/speaking/lecture.mp3')
    assert response.status_code==expected
    if expected==200:
        assert response.content==b'hello'
        assert response.headers['Cache-Control']=='private, no-store'
    else:
        assert response.json()=={'error':'forbidden'}


def test_media_range_refuses_values_outside_javascript_safe_integer():
    assert media_range('bytes=0-1',2**53) is None
    assert media_range('bytes=0-9007199254740992',100) is None
