from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
import httpx
import pytest
from app import main as core,media_readiness as readiness,step19_storage as storage,step20_media_port as media

USER={'id':'11111111-1111-4111-8111-111111111111','role':'owner','account_status':'active','auth_version':0}
class Pool:
 @asynccontextmanager
 async def acquire(self):yield self
 async def fetchrow(self,*a):return USER

@pytest.mark.asyncio
@pytest.mark.parametrize('status',[206,403])
async def test_probe_checks_real_transport_contract_without_mutating_learner_work(monkeypatch,status):
 monkeypatch.setattr(storage,'head_object',AsyncMock(return_value={'size':16000000,'contentType':'audio/mpeg'}))
 monkeypatch.setattr(storage,'read_object',AsyncMock(return_value=b'ID3'+b'0'*13))
 monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool()))
 monkeypatch.setattr(media,'allow_resource',AsyncMock(return_value='allowed'))
 monkeypatch.setattr(media,'media_conf',lambda:'synthetic-signing-secret-with-at-least-32-bytes')
 async def handler(req):
  assert req.method=='GET' and req.headers['range']=='bytes=0-15'
  assert req.url.host=='learnersarea-media.owneruchunla.workers.dev'
  return httpx.Response(status,content=b'ID3'+b'0'*13 if status==206 else b'',headers={'Content-Type':'audio/mpeg','Content-Range':'bytes 0-15/16000000'})
 client=httpx.AsyncClient
 monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:client(transport=httpx.MockTransport(handler),**kwargs))
 result=await readiness.probe()
 assert result['directReady'] is True and result['workerStatus']==status
 assert result.get('workerReady',False)==(status==206)
 assert 'token' not in str(result) and USER['id'] not in str(result)
 storage.read_object.assert_awaited_once_with(readiness.KEY,0,15)

@pytest.mark.asyncio
async def test_probe_never_logs_configuration_secrets_from_errors(monkeypatch):
 monkeypatch.setattr(storage,'head_object',AsyncMock(side_effect=ValueError('secret-bearing endpoint')))
 monkeypatch.setattr(media,'media_conf',lambda:None)
 result=await readiness.probe()
 assert result['directError']=='ValueError' and result['workerStatus']=='unconfigured'
 assert 'secret-bearing' not in str(result)

@pytest.mark.asyncio
async def test_full_probe_checks_all_bytes_hash_and_production_cors(monkeypatch):
 import hashlib
 body=b'ID3'+b'0'*16400
 monkeypatch.setenv('MEDIA_READINESS_FULL','1')
 monkeypatch.setattr(storage,'head_object',AsyncMock(return_value={'size':len(body),'contentType':'audio/mpeg','etag':hashlib.md5(body).hexdigest()}))
 monkeypatch.setattr(storage,'read_object',AsyncMock(return_value=body[:16]))
 monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool()))
 monkeypatch.setattr(media,'allow_resource',AsyncMock(return_value='allowed'))
 monkeypatch.setattr(media,'media_conf',lambda:'synthetic-signing-secret-with-at-least-32-bytes')
 async def handler(req):
  if req.headers.get('range'):return httpx.Response(206,content=body[:16],headers={'Content-Type':'audio/mpeg'})
  assert req.headers['origin']=='https://learnersarea.uz'
  return httpx.Response(200,content=body,headers={'Access-Control-Allow-Origin':'https://learnersarea.uz'})
 client=httpx.AsyncClient
 monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:client(transport=httpx.MockTransport(handler),**kwargs))
 result=await readiness.probe()
 assert result['fullReady'] and result['fullHashMatches'] and result['corsReady']
 assert result['fullBytes']==len(body) and result['fullStatus']==200
