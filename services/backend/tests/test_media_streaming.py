"""Private media headers, range semantics, bounded streaming and cancellation."""
import asyncio
from datetime import datetime,timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from starlette.requests import Request,ClientDisconnect
from starlette.responses import StreamingResponse
from app import main as core
from app import media_streaming as streams,step19_storage as storage,step20_media_port as media
from app.request_lifecycle import RequestBudget,WorkerControl

PRIVATE=media.PRIVATE
SCOPE={'type':'http','method':'GET','path':'/api/resources/test','headers':[],'asgi':{'spec_version':'2.4'}}
async def receive():await asyncio.Future()

def mock_http(monkeypatch,handler):
    original=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))

@pytest.mark.asyncio
async def test_upstream_is_not_buffered_and_disconnect_closes_everything(monkeypatch):
    class Body(httpx.AsyncByteStream):
        reads=0;closed=False
        async def __aiter__(self):
            for _ in range(1600):self.reads+=1;yield b'x'*streams.CHUNK_SIZE
        async def aclose(self):self.closed=True
    body=Body()
    async def handler(req):return httpx.Response(200,stream=body,headers={'Content-Length':str(100*1024*1024),'Content-Type':'video/mp4'})
    mock_http(monkeypatch,handler)
    response=await streams.upstream_response('GET','https://synthetic.invalid/private',{},PRIVATE)
    assert body.reads==0 and response.headers['cache-control']=='private, no-store'
    async def send(message):
        if message['type']=='http.response.body':
            assert len(message.get('body',b''))<=streams.CHUNK_SIZE
            raise OSError('synthetic client disconnected')
    with pytest.raises(Exception):await response(SCOPE,receive,send)
    assert body.closed and body.reads==1

@pytest.mark.asyncio
async def test_total_transfer_deadline_cancels_and_closes_a_slow_stream():
    closed=[]
    async def chunks():
        yield b'first';await asyncio.sleep(1);yield b'late'
    async def cleanup():closed.append(True)
    response=streams.BoundedMediaResponse(StreamingResponse(chunks()),cleanup,timeout=.01)
    messages=[]
    async def send(message):messages.append(message)
    with pytest.raises(TimeoutError):await response(SCOPE,receive,send)
    assert closed==[True] and [m['type'] for m in messages].count('http.response.start')==1
    assert not any(m.get('body')==b'late' for m in messages)

@pytest.mark.asyncio
async def test_head_does_not_consume_upstream_body(monkeypatch):
    class Body(httpx.AsyncByteStream):
        closed=False
        async def __aiter__(self):raise AssertionError('HEAD read bytes');yield
        async def aclose(self):self.closed=True
    body=Body()
    async def handler(req):
        assert req.method=='HEAD'
        return httpx.Response(200,stream=body,headers={'Content-Length':'123456','Content-Type':'audio/mpeg'})
    mock_http(monkeypatch,handler)
    response=await streams.upstream_response('HEAD','https://synthetic.invalid',{},PRIVATE)
    assert response.status_code==200 and response.headers['content-length']=='123456' and body.closed

@pytest.mark.asyncio
@pytest.mark.parametrize('content',[b'0123456789',b'truncated'])
async def test_stream_preserves_bytes_and_does_not_report_a_truncated_body_complete(monkeypatch,content):
    async def handler(req):return httpx.Response(200,stream=httpx.ByteStream(content),headers={'Content-Length':'10'})
    mock_http(monkeypatch,handler)
    response=await streams.upstream_response('GET','https://synthetic.invalid',{},PRIVATE)
    bodies=[]
    async def send(message):
        if message['type']=='http.response.body':bodies.append(message)
    if len(content)==10:
        await response(SCOPE,receive,send)
        assert b''.join(m.get('body',b'') for m in bodies)==content
        assert bodies[-1].get('more_body') is False
    else:
        with pytest.raises(ClientDisconnect):await response(SCOPE,receive,send)
        assert not any(m.get('more_body') is False for m in bodies)

@pytest.mark.asyncio
@pytest.mark.parametrize('status',[404,412,500])
async def test_s3_errors_do_not_leak_xml_or_stale_body_lengths(monkeypatch,status):
    async def handler(req):return httpx.Response(status,content=b'<PrivateBucketName/>')
    mock_http(monkeypatch,handler)
    response=await streams.upstream_response('GET','https://synthetic.invalid',{},
        {**PRIVATE,'Content-Length':'999999','Content-Range':'bytes 0-1/999999'},object_fallback=True)
    assert response.status_code==(status if status in (404,412) else 503)
    assert response.body==b'' and response.headers['content-length']=='0' and 'content-range' not in response.headers

@pytest.mark.asyncio
async def test_private_s3_get_is_sigv4_conditional_and_internal_only(monkeypatch):
    calls=[]
    class Client:
        def generate_presigned_url(self,*args,**kwargs):calls.append((args,kwargs));return 'https://synthetic.invalid/signed-private'
    monkeypatch.setattr(storage,'_client',lambda:(Client(),'isolated-bucket'))
    url=await storage.presigned_read_url('audio/test.mp3','"version"')
    assert url=='https://synthetic.invalid/signed-private'
    assert calls==[(('get_object',),{'Params':{'Bucket':'isolated-bucket','Key':'audio/test.mp3','IfMatch':'"version"'},'ExpiresIn':300,'HttpMethod':'GET'})]
    assert storage.client_options().signature_version=='s3v4'

@pytest.mark.asyncio
async def test_real_sdk_presigns_the_exact_read_and_if_match_without_network(monkeypatch):
    from urllib.parse import urlsplit,parse_qs
    for name,value in {'STORAGE_PROVIDER':'r2','R2_BUCKET_NAME':'isolated','R2_ACCESS_KEY_ID':'synthetic-key',
       'R2_SECRET_ACCESS_KEY':'synthetic-secret','R2_ENDPOINT':'https://synthetic.r2.cloudflarestorage.com','R2_REGION':'auto'}.items():monkeypatch.setenv(name,value)
    url=await storage.presigned_read_url('audio/private.mp3','"version"')
    parsed=urlsplit(url);query=parse_qs(parsed.query)
    assert parsed.hostname=='synthetic.r2.cloudflarestorage.com' and parsed.path.endswith('/audio/private.mp3')
    assert query['X-Amz-Algorithm']==['AWS4-HMAC-SHA256'] and query['X-Amz-Expires']==['300']
    assert 'if-match' in query['X-Amz-SignedHeaders'][0].split(';')

@pytest.mark.asyncio
async def test_local_file_range_head_and_if_range_remain_private(monkeypatch,tmp_path):
    monkeypatch.setenv('STORAGE_PROVIDER','local');monkeypatch.setenv('STORAGE_LOCAL_DIR',str(tmp_path))
    (tmp_path/'audio.mp3').write_bytes(b'0123456789')
    info=await storage.head_object('audio.mp3')
    headers={**PRIVATE,'Content-Type':'audio/mpeg','Content-Disposition':'inline; filename="audio.mp3"'}
    async def call(method,request_headers):
        scope={**SCOPE,'method':method,'headers':[(k.encode(),v.encode()) for k,v in request_headers.items()]}
        req=Request(scope);response=await streams.object_response(req,'audio.mp3',info,headers,None,method=='HEAD')
        messages=[]
        async def send(message):messages.append(message)
        await response(scope,receive,send)
        return messages[0],b''.join(m.get('body',b'') for m in messages[1:])
    start,body=await call('GET',{'range':'bytes=2-5','if-range':info['etag']})
    assert start['status']==206 and body==b'2345'
    assert dict(start['headers'])[b'cache-control']==b'private, no-store'
    start,body=await call('HEAD',{'range':'bytes=2-5'})
    assert start['status']==200 and body==b'' and dict(start['headers'])[b'content-length']==b'10'
    start,body=await call('GET',{'range':'bytes=2-5','if-range':'"different"'})
    assert start['status']==200 and body==b'0123456789'

def test_if_range_and_extreme_ranges_are_bounded():
    info={'etag':'"a"','lastModified':datetime(2026,10,28,tzinfo=timezone.utc)}
    assert streams.if_range_matches('"a"',info)
    assert streams.if_range_matches('Wed, 28 Oct 2026 00:00:00 GMT',info)
    assert not streams.if_range_matches('Tue, 27 Oct 2026 00:00:00 GMT',info)
    assert not streams.if_range_matches('W/"a"',info)
    assert media.media_range('bytes='+'9'*5000+'-',10) is None
    assert media.media_range('bytes='+'0'*5000+'-1',10)==(0,1)

def test_local_stream_refuses_a_symlink_outside_storage(monkeypatch,tmp_path):
    root=tmp_path/'root';root.mkdir();(tmp_path/'private.txt').write_text('private')
    (root/'linked.txt').symlink_to(tmp_path/'private.txt');monkeypatch.setenv('STORAGE_LOCAL_DIR',str(root))
    with pytest.raises(ValueError):storage.local_object_path('linked.txt')

@pytest.mark.asyncio
async def test_media_saturation_preserves_ordinary_requests_and_readiness():
    controller=WorkerControl();state=controller.state();started=asyncio.Event();finish=asyncio.Event()
    async def app(scope,receive,send):
        if scope['path'].startswith('/api/resources/') and scope['method']=='GET' and scope.get('query_string')!=b'capability=1':
            started.set();await finish.wait()
        await send({'type':'http.response.start','status':200,'headers':[]});await send({'type':'http.response.body','body':b'ok'})
    wrapped=RequestBudget(app,controller=controller,media=1)
    async def call(path,query=b''):
        messages=[]
        async def send(message):messages.append(message)
        await wrapped({**SCOPE,'path':path,'query_string':query},receive,send)
        return messages[0]['status']
    first=asyncio.create_task(call('/api/resources/large.mp4'));await started.wait()
    assert state.media==1 and state.active==0
    assert await call('/api/resources/other.mp4')==503
    assert await call('/api/resources/large.mp4',b'capability=1')==200
    assert await call('/api/frontend/session')==200 and await call('/readyz')==200
    finish.set();assert await first==200 and state.media==0
