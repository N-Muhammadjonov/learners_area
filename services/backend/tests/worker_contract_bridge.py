"""stdio bridge for existing Worker/FastAPI contract integration; no real accounts/R2.
Only this isolated child process uses fixed public fixture credentials and fake DB authority.
"""
import asyncio,base64,json,os,sys,time,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app import main as core
from app.asgi import application
from app import step20_media_port as media
from app import step17_dictionary_read_port as dictionary
import httpx
SECRET='isolated-worker-contract-fixture-secret-32-bytes'
os.environ.update(MEDIA_WORKER_URL=media.ORIGIN+'/',MEDIA_SIGNING_SECRET=SECRET,
 DICTIONARY_WORKER_URL='https://learnersarea-dictionary.owneruchunla.workers.dev/',DICTIONARY_SIGNING_SECRET=SECRET)
UID=uuid.UUID('11111111-1111-4111-8111-111111111111')
state={'mode':'allowed'}
user={'id':UID,'name':'Isolated fixture','email':None,'role':'student','account_status':'active'}
async def authority(req):
 return {'user':user,'authVersion':7,'sessionKey':'a'*64,'expiresAt':int(time.time())+3600}
class Connection:
 def acquire(self):return self
 async def __aenter__(self):return self
 async def __aexit__(self,*args):pass
 async def fetchrow(self,sql,*args):
  assert 'FROM users' in sql and 'auth_version=$2' in sql and 'auth_session_revocations' in sql
  assert args==(UID,7,'a'*64)
  if state['mode'] in ('revoked','version-changed'):return None
  return {**user,'account_status':'suspended' if state['mode']=='suspended' else 'active'}
async def pool():return Connection()
async def allowed(con,u,key):
 return 'allowed' if key=='audio/contract.mp3' and state['mode']!='unpublished' else 'forbidden'
core.pool=pool;core.current_authority=authority;media.allow_resource=allowed
client=TestClient(application,base_url='https://learnersarea.uz')
def encode(response):
 return {'status':response.status_code,'headers':dict(response.headers),'body':base64.b64encode(response.content).decode()}
class GatewayTransport:
 async def __aenter__(self):return self
 async def __aexit__(self,*args):pass
 async def post(self,url,content,headers):
  print(json.dumps({'event':'dictionary-request','url':url,'headers':headers,'body':base64.b64encode(content).decode()}),flush=True)
  reply=json.loads(sys.stdin.readline())
  assert reply.get('event')=='dictionary-response'
  return httpx.Response(reply['status'],content=base64.b64decode(reply['body']),headers=reply.get('headers'))
original=httpx.AsyncClient
for line in sys.stdin:
 try:
  command=json.loads(line);op=command['op']
  if op=='http':
   response=client.request(command['method'],command['path'],content=base64.b64decode(command.get('body','')),headers=command.get('headers',{}),follow_redirects=False)
   result=encode(response)
  elif op=='mode':state['mode']=command['mode'];result={'ok':True}
  elif op=='dictionary':
   httpx.AsyncClient=lambda **kwargs:GatewayTransport()
   try:result=asyncio.run(dictionary.worker(command['input']))
   finally:httpx.AsyncClient=original
  else:raise ValueError('unknown_operation')
  print(json.dumps({'event':'result','id':command['id'],'result':result}),flush=True)
 except Exception as e:
  httpx.AsyncClient=original
  print(json.dumps({'event':'result','id':command.get('id'),'error':type(e).__name__+': '+str(e)}),flush=True)
