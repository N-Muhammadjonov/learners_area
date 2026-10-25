"""Content-import validation parity gates, read-only DB queries and wire contracts.
These are mocked DB/HTTP regression tests, not live PostgreSQL or Next.js tests.
"""
from __future__ import annotations
import copy,json
from uuid import UUID
import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.step38_content_validation import parse_package, InvalidPackage,package_hash
from app.step38_content_validate import semantic_projection

C=TestClient(core.app)
ID='11111111-1111-4111-8111-111111111111'
ROUTES=[('POST','/api/grammar/exercises/'+ID+'/practice'),
 ('POST','/api/writing/submissions/'+ID+'/submit'),
 ('POST','/api/speaking/attempts/'+ID+'/submit'),
 ('POST','/api/assignments/'+ID+'/evaluate'),
 ('POST','/api/admin/reading/import'),
 ('POST','/api/retention/attempts'),
 ('POST','/api/retention/attempts/'+ID+'/submit'),
 ('GET','/api/owner/student-export'),
 ('GET','/api/reports'),
 ('POST','/api/admin/content/validate')]

def reading():
 return {'schemaVersion':1,'module':'reading','contentType':'general_set',
 'sourceRef':'general-reading-qa','title':'General Reading QA',
 'content':{'level':'B1','passages':[{'passageNo':1,'title':'Text','body':'Some source evidence in body',
 'questions':[{'questionNo':1,'type':'short_answer','text':'What is this?','answer':'Text','evidence':'source evidence'}]}]}}

def listening():
 return {'schemaVersion':2,'module':'listening','contentType':'full_test','sourceRef':'listening-test-1',
 'title':'Listening Test','assets':[{'key':'audio.full','role':'audio','mimeTypes':['audio/mpeg']}],
 'content':{'collection':'academic','audio':{'durationSec':900},
 'sections':[{'number':1,'title':'Part 1','transcript':'He said answer'}],
 'questions':[{'number':1,'section':1,'text':'Question','instruction':'Complete the blank',
 'kind':'completion','options':[],'answer':'answer','alternatives':[],'pair':[],
 'evidence':{'at':10,'why':'He said answer'}}]}}

class Conn:
 def __init__(self):self.calls=[];self.import_row=None;self.domain=None;self.duplicate_rows=[];self.table_ready=True
 async def fetchrow(self,sql,*args):
  self.calls.append(('fetchrow',sql,args))
  if 'FROM content_imports' in sql:return self.import_row
  if 'FROM general_reading_sets' in sql or 'FROM listening_packages' in sql:return self.domain
  raise AssertionError('Unexpected fetchrow '+sql)
 async def fetchval(self,sql,*args):
  self.calls.append(('fetchval',sql,args))
  assert 'to_regclass' in sql
  return self.table_ready
 async def fetch(self,sql,*args):
  self.calls.append(('fetch',sql,args))
  assert 'FROM content_versions' in sql
  return self.duplicate_rows
 async def execute(self,*args):raise AssertionError('Validation must never write')
 def transaction(self):raise AssertionError('Validation must not open transaction')
 async def __aenter__(self):return self
 async def __aexit__(self,*args):return False
class Pool:
 def __init__(self,con):self.con=con
 def acquire(self):return self.con

@pytest.fixture
def env(monkeypatch):
 conn=Conn()
 async def user(*args,**kwargs):return {'id':UUID(ID),'role':'admin','account_status':'active'}
 async def pool():return Pool(conn)
 monkeypatch.setattr(core,'current_user',user)
 monkeypatch.setattr(core,'pool',pool)
 return conn

@pytest.mark.parametrize('method,path',ROUTES)
def test_all_ten_new_methods_require_auth_before_database(monkeypatch,method,path):
 async def no_user(*args,**kwargs):return None
 async def no_database():raise AssertionError('An anonymous request reached the database')
 monkeypatch.setattr(core,'current_user',no_user)
 monkeypatch.setattr(core,'pool',no_database)
 r=C.request(method,path,json={ } if method=='POST' else None)
 assert r.status_code==(403 if path=='/api/owner/student-export' else 401),(method,path,r.status_code,r.text)
 assert r.json()==({'error':'forbidden'} if path=='/api/owner/student-export' else {'error':{'code':'unauthorized'}} if path=='/api/reports' else {'error':'unauthenticated'})

def test_reading_preview_and_response_shape_read_only(env):
 r=C.post('/api/admin/content/validate',json={'package':reading()})
 assert r.status_code==200,r.text
 body=r.json()
 assert body['ok'] and body['module']=='reading' and body['contentType']=='general_set'
 assert body['schemaVersion']==body['importerVersion']==1
 assert body['contentHash'] is None and body['sourceStatus']=={'status':'new'}
 assert body['requiredAssets']==body['missingAssetKeys']==body['duplicates']==body['issues']==body['warnings']==[]
 assert body['capabilities']=={'key':'reading:general_set:v1','label':'General Reading set'}
 assert [row['label'] for row in body['preview']['lines']]==['Source identity','Passages','Questions','Vocabulary items','Level','Publication intent','Provenance']
 assert r.headers['cache-control']=='private, no-store'
 assert len(env.calls)==4 and {row[0] for row in env.calls}=={'fetchrow','fetchval','fetch'}

def test_identical_previous_content_and_latest_version(env):
 p=reading();pkg,_=parse_package(p)
 env.import_row={'content_hash':package_hash(pkg),'content_version':7}
 result=C.post('/api/admin/content/validate',json=p)
 assert result.status_code==200
 assert result.json()['sourceStatus']=={'status':'identical','detail':'v7'}

def test_changed_and_legacy_source_ref_cases(env):
 env.import_row={'content_hash':'0'*64,'content_version':3}
 assert C.post('/api/admin/content/validate',json=reading()).json()['sourceStatus']=={'status':'changed','detail':'v3'}
 env.import_row=None;env.domain={'exists':1}
 assert C.post('/api/admin/content/validate',json=reading()).json()['sourceStatus']=={'status':'changed','detail':'existing_material_without_import_record'}

def test_duplicate_candidates_latest_version_and_evidence(env):
 p=reading();pkg,_=parse_package(p)
 from app.step38_content_validation import standard_hash
 full=standard_hash({'module':'reading','contentType':'general_set','content':pkg['content']})
 semantic=standard_hash({'module':'reading','contentType':'general_set','semester':'assessment-semantics/v1','content':semantic_projection('reading','general_set',pkg['content'])})
 env.duplicate_rows=[{'module':'reading','content_type':'general_set','source_ref':'second','version_no':1,'status':'draft','content_hash':full,'semantic_hash':'x'},
 {'module':'reading','content_type':'general_set','source_ref':'second','version_no':4,'status':'published','content_hash':full,'semantic_hash':'x'},
 {'module':'reading','content_type':'general_set','source_ref':'third','version_no':2,'status':'draft','content_hash':'x','semantic_hash':semantic}]
 r=C.post('/api/admin/content/validate',json=p)
 assert r.status_code==200
 d=r.json()['duplicates']
 assert d==[{'module':'reading','contentType':'general_set','sourceRef':'second','versionNo':4,'status':'published','evidence':'identical_content'},
 {'module':'reading','contentType':'general_set','sourceRef':'third','versionNo':2,'status':'draft','evidence':'identical_semantics'}]

def test_invalid_json_and_oversized_before_database(env):
 r=C.post('/api/admin/content/validate',content='{not JSON',headers={'content-type':'application/json'})
 assert r.status_code==400 and r.json()=={'error':'invalid_json'}
 r=C.post('/api/admin/content/validate',content=b' '* (2*1024*1024+1),headers={'content-type':'application/json'})
 assert r.status_code==413 and r.json()=={'error':'payload_too_large'}
 assert env.calls==[]

@pytest.mark.parametrize('package,code',[
 ({'schemaVersion':1},'invalid_input'),
 ({},'schema_invalid'),
 ({'module':'reading','schemaVersion':1},'schema_invalid'),
 ({**reading(),'schemaVersion':23},'unsupported_schema_version'),
 ({**reading(),'contentType':'other_content'},'unknown_content_type'),
])
def test_schema_rejections_without_db(env,package,code):
 r=C.post('/api/admin/content/validate',json=package)
 assert r.status_code==400 and r.json()['code']==code
 assert r.json()['ok'] is False and r.json()['issues']
 assert r.headers['cache-control']=='private, no-store'
 assert env.calls==[]

def test_teacher_forbidden_and_no_database(env,monkeypatch):
 async def teacher(*a,**kw):return {'id':UUID(ID),'role':'teacher','account_status':'active'}
 monkeypatch.setattr(core,'current_user',teacher)
 r=C.post('/api/admin/content/validate',json=reading())
 assert r.status_code==403 and r.json()=={'ok':False,'error':'forbidden'}
 assert not env.calls

def test_content_hash_incorrect_is_rejected_before_database(env):
 p=reading();p['contentHash']='f'*64
 r=C.post('/api/admin/content/validate',json=p)
 assert r.status_code==400 and r.json()['code']=='content_hash_mismatch'
 assert env.calls==[]

def test_duplicate_passage_and_executable_markup_blocked(env):
 p=reading();p['content']['passages'].append(copy.deepcopy(p['content']['passages'][0]))
 assert C.post('/api/admin/content/validate',json=p).json()['code']=='semantic_invalid'
 p=reading();p['content']['passages'][0]['body']='<script>alert(1)</script>'
 assert C.post('/api/admin/content/validate',json=p).json()['code']=='executable_markup'
 assert not env.calls

def test_listening_alias_and_required_asset_parity(env):
 p=listening()
 r=C.post('/api/admin/content/validate',json=p)
 assert r.status_code==200,r.text
 b=r.json()
 assert b['module']=='listening' and b['importerVersion']==2
 assert b['requiredAssets'][0]['key']=='audio.full' and b['requiredAssets'][0]['maxBytes']==200*1024*1024
 assert b['warnings'] and 'normally has 4 parts' in ' '.join(b['warnings'])
 assert b['missingAssetKeys']==[]

def test_listening_missing_declaration_rejected_before_queries(env):
 p=listening();p['assets']=[]
 r=C.post('/api/admin/content/validate',json=p)
 assert r.status_code==400 and r.json()['code']=='asset_missing'
 assert r.json()['issues'][0]['level']==3
 assert not env.calls

def test_listening_source_ref_must_be_safe(env):
 p=listening();p['sourceRef']='Invalid_Ref'
 r=C.post('/api/admin/content/validate',json=p)
 assert r.status_code==400 and r.json()['code']=='semantic_invalid'
 assert not env.calls

def legacy_listening():
 p=listening();c=p['content'];q=copy.deepcopy(c['questions'])
 for v in q:
  v['key']=v.pop('answer')
 return {'schemaVersion':1,'testId':p['sourceRef'],'title':p['title'],
         'category':'full','provenance':'Upgraded from legacy v1 source.',
         'audio':{'path':'audio/full.mp3','durationSec':c['audio']['durationSec']},
         'imagePath':None,'sections':c['sections'],'questions':q,
         'keyword1':[],'keyword2':[],'vocabulary':[]}

def test_v1_bare_listening_package_is_upgraded_without_writing(env):
 r=C.post('/api/admin/content/validate',json=legacy_listening())
 assert r.status_code==200,r.text
 b=r.json()
 assert b['ok'] and b['module']=='listening' and b['schemaVersion']==2
 assert b['migratedFrom']==1 and b['importerVersion']==2
 assert b['preview']['lines'][-1]['value'].startswith('Converted from legacy material; Upgraded from legacy v1 source.')
 assert b['requiredAssets'][0]['declared'] is True
 assert b['requiredAssets'][0]['path']=='audio/full.mp3'

def test_v1_bare_rejects_unsupported_or_executable_payload_without_database(env):
 legacy=legacy_listening();legacy['authoredRuntime']={'entryPath':'index.html','files':{'index.html':'<script>bad</script>'}}
 r=C.post('/api/admin/content/validate',json=legacy)
 assert r.status_code==400 and r.json()['code']=='invalid_input'
 legacy=legacy_listening();legacy['schemaVersion']=3
 r=C.post('/api/admin/content/validate',json=legacy)
 assert r.status_code==400 and r.json()['code']=='invalid_input'
 assert not env.calls

def test_hash_normalized_numeric_float_and_trim():
 from app.step38_content_validation import standard_hash
 assert standard_hash({'x':1.0,'y':' hello  '})==standard_hash({'x':1,'y':'hello'})
