"""Private, bounded media delivery; upstream URLs never leave the backend."""
import asyncio
import logging
from email.utils import parsedate_to_datetime

import anyio
import httpx
from starlette.responses import Response,StreamingResponse,FileResponse

LOG=logging.getLogger('uvicorn.error')
CHUNK_SIZE=64*1024
TRANSFER_TIMEOUT=300
FORWARDED=('Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag',
           'Last-Modified','Content-Disposition','Content-Encoding')

class BoundedMediaResponse(Response):
    def __init__(self,response,cleanup=None,*,timeout=TRANSFER_TIMEOUT):
        self.response=response;self.cleanup=cleanup;self.timeout=timeout
        self.status_code=response.status_code;self.raw_headers=response.raw_headers
        self.background=None

    async def __call__(self,scope,receive,send):
        try:
            async with asyncio.timeout(self.timeout):await self.response(scope,receive,send)
        finally:
            if self.cleanup:
                with anyio.move_on_after(5,shield=True):await self.cleanup()

def if_range_matches(value,info):
    if not value:return True
    if value.startswith('W/'):return False
    if value==info.get('etag'):return True
    try:
        modified=info.get('lastModified')
        return modified is not None and modified.timestamp()<parsedate_to_datetime(value).timestamp()+1
    except (ValueError,TypeError,AttributeError,OverflowError):return False

async def upstream_response(method,url,headers,private,*,object_fallback=False):
    client=httpx.AsyncClient(timeout=httpx.Timeout(20,connect=5,read=10),follow_redirects=False)
    reply=None
    async def close():
        try:
            if reply is not None:await reply.aclose()
        finally:await client.aclose()
    try:
        reply=await client.send(client.build_request(method,url,headers=headers),stream=True)
        output={k:v for k,v in private.items() if k.lower() not in ('content-length','content-range')}
        for name in FORWARDED:
            if name in reply.headers:output[name]=reply.headers[name]
        if reply.status_code not in (200,206):
            status=(reply.status_code if reply.status_code in (404,412) else 503) if object_fallback else (
                reply.status_code if 400<=reply.status_code<=599 else 503)
            output={k:v for k,v in output.items() if k.lower() not in ('content-length','content-encoding') and (status==416 or k.lower()!='content-range')}
            await close();return Response(status_code=status,headers=output)
        if method=='HEAD':
            await close();return Response(status_code=reply.status_code,headers=output)
        expected=int(reply.headers['content-length']) if 'content-length' in reply.headers else None
        if expected is not None and expected<0:raise ValueError('invalid_media_length')
        async def chunks():
            received=0
            try:
                async for chunk in reply.aiter_raw(CHUNK_SIZE):
                    received+=len(chunk)
                    yield chunk
                if expected is not None and received!=expected:raise OSError('media_length_mismatch')
            except (httpx.HTTPError,OSError):
                LOG.warning('Private media upstream stream interrupted')
                raise OSError('private_media_stream_interrupted') from None
        return BoundedMediaResponse(StreamingResponse(chunks(),status_code=reply.status_code,headers=output),close)
    except BaseException:
        with anyio.move_on_after(5,shield=True):await close()
        raise

async def object_response(req,key,info,headers,span,head):
    from .step19_storage import provider,local_object_path,presigned_read_url
    if head:
        output={k:v for k,v in headers.items() if k.lower()!='content-range'}
        output['Content-Length']=str(info['size'])
        return Response(status_code=200,headers=output)
    if provider()=='local':
        # FileResponse uses bounded asynchronous file reads and closes on disconnect.
        from .request_lifecycle import run_io
        path=local_object_path(key)
        try:stat=await run_io(path.stat)
        except FileNotFoundError:
            return Response(status_code=404,headers={k:v for k,v in headers.items() if k.lower() not in ('content-length','content-range')})
        file_headers={k:v for k,v in headers.items() if k not in ('Content-Length','Content-Range','ETag','Last-Modified')}
        response=FileResponse(path,stat_result=stat,headers=file_headers,media_type=headers['Content-Type'])
        return BoundedMediaResponse(response)
    signed_headers={'If-Match':info['etag']} if info.get('etag') else {}
    url=await presigned_read_url(key,info.get('etag'))
    if span:signed_headers['Range']=f'bytes={span[0]}-{span[1]}'
    # Content-Disposition can differ in uploaded S3 metadata: retain the established
    # API decision rather than exposing the signed URL or arbitrary upstream headers.
    response=await upstream_response('GET',url,signed_headers,headers,object_fallback=True)
    response.headers['Content-Disposition']=headers['Content-Disposition']
    # BoundedMediaResponse delegates ASGI output to the wrapped response.
    if hasattr(response,'response'):response.response.headers['Content-Disposition']=headers['Content-Disposition']
    return response
