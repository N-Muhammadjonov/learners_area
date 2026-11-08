"""Native Listening transport survives stale Worker grants without widening access."""
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from starlette.requests import Request
from starlette.responses import Response
from app import main as core,step20_media_port as media

KEY='listening/academic/test-01/full.mp3'
AUTHORITY={'user':{'id':'11111111-1111-4111-8111-111111111111','account_status':'active'},
           'authVersion':0,'sessionKey':'a'*64,'expiresAt':4102444800}

class Pool:
 @asynccontextmanager
 async def acquire(self):yield object()

@pytest.fixture
def transport(monkeypatch):
 monkeypatch.setattr(core,'current_authority',AsyncMock(return_value=AUTHORITY))
 monkeypatch.setattr(core,'_load_authority',AsyncMock(return_value=AUTHORITY))
 monkeypatch.setattr(core,'pool',AsyncMock(return_value=Pool()))
 monkeypatch.setattr(media,'allow_resource',AsyncMock(return_value='allowed'))
 monkeypatch.setattr(media,'media_conf',lambda:'synthetic-signing-secret-longer-than-32-bytes')
 monkeypatch.setattr(media,'head_object',AsyncMock(return_value={'size':10,'contentType':'audio/mpeg','etag':'"one"'}))
 monkeypatch.setattr(media,'object_response',AsyncMock(return_value=Response(b'2345',status_code=206,headers={**media.PRIVATE,'Content-Type':'audio/mpeg','Content-Range':'bytes 2-5/10'})))
 monkeypatch.setattr(media,'upstream_response',AsyncMock())
 return media

def request(query=b'',headers=(),method='GET'):
 return Request({'type':'http','method':method,'scheme':'https','server':('learnersarea.uz',443),
   'path':'/api/resources/'+KEY,'query_string':query,'headers':headers})

@pytest.mark.asyncio
async def test_listening_capability_keeps_native_ranges_on_authenticated_origin(transport):
 result=await media.deliver(request(b'capability=1'),KEY,False)
 assert result.status_code==200
 cap=json.loads(result.body)
 assert cap['url']=='/api/resources/'+KEY+'?stream=1'
 assert cap['key']==KEY and cap['expiresAt']>0
 assert result.headers['cache-control']=='private, no-store'
 media.upstream_response.assert_not_awaited();media.head_object.assert_not_awaited()

@pytest.mark.asyncio
@pytest.mark.parametrize('status',[401,403,500,502,503,504])
async def test_worker_transport_failure_uses_bounded_authorized_fallback(transport,status):
 media.upstream_response.return_value=Response(status_code=status)
 req=request(b'stream=1',[(b'range',b'bytes=2-5')])
 result=await media.deliver(req,KEY,False)
 assert result.status_code==206 and result.body==b'2345'
 assert result.headers['content-type']=='audio/mpeg'
 assert result.headers['cache-control']=='private, no-store'
 args=media.object_response.await_args.args
 assert args[1]==KEY and args[4]==(2,5) and args[5] is False
 assert media.upstream_response.await_args.args[2]=={'range':'bytes=2-5'}
 assert core._load_authority.await_count==(1 if status in (401,403) else 0)

@pytest.mark.asyncio
async def test_revoked_session_cannot_use_worker_denial_fallback(transport):
 media.upstream_response.return_value=Response(status_code=403)
 core._load_authority.return_value=None
 result=await media.deliver(request(b'stream=1'),KEY,False)
 assert result.status_code==401
 media.head_object.assert_not_awaited();media.object_response.assert_not_awaited()

@pytest.mark.asyncio
async def test_resource_lock_change_cannot_use_worker_denial_fallback(transport):
 media.upstream_response.return_value=Response(status_code=403)
 media.allow_resource.side_effect=['allowed','forbidden']
 result=await media.deliver(request(b'stream=1'),KEY,False)
 assert result.status_code==403
 media.head_object.assert_not_awaited();media.object_response.assert_not_awaited()

@pytest.mark.asyncio
async def test_initial_permission_denial_does_not_contact_worker_or_storage(transport):
 media.allow_resource.return_value='forbidden'
 result=await media.deliver(request(b'capability=1'),KEY,False)
 assert result.status_code==403
 media.upstream_response.assert_not_awaited();media.head_object.assert_not_awaited()

@pytest.mark.asyncio
async def test_worker_missing_object_stays_missing(transport):
 media.upstream_response.return_value=Response(status_code=404)
 result=await media.deliver(request(b'stream=1'),KEY,False)
 assert result.status_code==404
 media.head_object.assert_not_awaited()

@pytest.mark.asyncio
async def test_successful_worker_range_does_not_use_fallback(transport):
 media.upstream_response.return_value=Response(b'2345',status_code=206,headers={'Content-Type':'audio/mpeg','Content-Range':'bytes 2-5/10'})
 result=await media.deliver(request(b'stream=1',[(b'range',b'bytes=2-5')]),KEY,False)
 assert result.status_code==206 and result.body==b'2345'
 media.head_object.assert_not_awaited();media.object_response.assert_not_awaited()

@pytest.mark.asyncio
async def test_head_fallback_describes_whole_object_without_reading_body(transport):
 media.upstream_response.return_value=Response(status_code=503)
 media.object_response.return_value=Response(status_code=200,headers={**media.PRIVATE,'Content-Length':'10'})
 result=await media.deliver(request(b'stream=1',[(b'range',b'bytes=2-5')],method='HEAD'),KEY,True)
 assert result.status_code==200 and result.body==b'' and result.headers['content-length']=='10'
 assert media.object_response.await_args.args[4:] == (None,True)

@pytest.mark.asyncio
async def test_other_resource_capabilities_keep_existing_worker_contract(transport):
 key='audio/contract.mp3'
 result=await media.deliver(request(b'capability=1'),key,False)
 assert result.status_code==200
 assert json.loads(result.body)['url'].startswith(media.ORIGIN+'/v1/media/')
 media.upstream_response.assert_not_awaited()

@pytest.mark.asyncio
async def test_direct_listening_capability_avoids_relay_after_resource_authorization(transport):
 result=await media.deliver(request(b'capability=1&direct=1'),KEY,False)
 assert result.status_code==200
 grant=json.loads(result.body)
 assert grant['url'].startswith(media.ORIGIN+'/v1/media/') and grant['key']==KEY
 media.allow_resource.assert_awaited_once()
 media.upstream_response.assert_not_awaited();media.head_object.assert_not_awaited()

@pytest.mark.asyncio
async def test_direct_listening_capability_does_not_bypass_sequence_lock(transport):
 media.allow_resource.return_value='forbidden'
 result=await media.deliver(request(b'capability=1&direct=1'),KEY,False)
 assert result.status_code==403 and 'url' not in json.loads(result.body)
 media.upstream_response.assert_not_awaited()
