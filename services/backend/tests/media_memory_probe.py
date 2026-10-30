"""100 MiB proxy comparison, synthetic HTTP bytes; no R2/production/network.

Run each version in a fresh process. MEDIA_DELIVERY_BASELINE points to the exact
prior step20_media_port.py archived from 08ec12d. No learner records are used.
"""
import asyncio
import importlib.util
import json
import os
import sys
import time
import tracemalloc
from uuid import UUID

import httpx
from starlette.requests import Request
from app import main as core,step20_media_port as current

MODE=os.environ.get('MEDIA_MEMORY_MODE','after')
assert MODE in ('before','after')
if MODE=='before':
    spec=importlib.util.spec_from_file_location('app._before_media_stream',os.environ['MEDIA_DELIVERY_BASELINE'])
    media=importlib.util.module_from_spec(spec);spec.loader.exec_module(media)
else:media=current
os.environ.update(MEDIA_WORKER_URL=media.ORIGIN+'/',MEDIA_SIGNING_SECRET='isolated-media-memory-signing-key-32-bytes')
SIZE=100*1024*1024
size=16

async def authority(req):
    return {'user':{'id':UUID(int=1),'role':'student','account_status':'active'},'authVersion':0,'sessionKey':'a'*64,'expiresAt':int(time.time())+3600}
class DB:
    def acquire(self):return self
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
async def pool():return DB()
async def allowed(*args):return 'allowed'
core.current_authority=authority;core.pool=pool;media.allow_resource=allowed
class Body(httpx.AsyncByteStream):
    async def __aiter__(self):
        for offset in range(0,size,65536):
            yield b'x'*min(65536,size-offset)
            await asyncio.sleep(0)
    async def aclose(self):pass
async def handler(req):
    assert req.url.host=='learnersarea-media.owneruchunla.workers.dev'
    return httpx.Response(200,stream=Body(),headers={'Content-Type':'video/mp4','Content-Length':str(size),
       'Content-Disposition':'inline; filename="synthetic.mp4"'})
original=httpx.AsyncClient
httpx.AsyncClient=lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs)

async def main():
    global size
    scope={'type':'http','method':'GET','path':'/api/resources/video/synthetic.mp4','query_string':b'download=1',
      'headers':[],'scheme':'https','server':('learnersarea.uz',443),'asgi':{'spec_version':'2.4'}}
    async def receive():await asyncio.Future()
    async def exercise():
        first=None;total=0;maximum=0;start=time.perf_counter()
        response=await media.deliver(Request(scope),'video/synthetic.mp4',False)
        assert response.status_code==200 and response.headers['cache-control']=='private, no-store'
        async def send(message):
            nonlocal first,total,maximum
            if message['type']=='http.response.body' and message.get('body'):
                if first is None:first=(time.perf_counter()-start)*1000
                total+=len(message['body']);maximum=max(maximum,len(message['body']))
        await response(scope,receive,send)
        assert total==size
        return {'bytes':total,'maximum_asgi_chunk':maximum,'first_byte_ms':round(first,3),'elapsed_ms':round((time.perf_counter()-start)*1000,3)}
    await exercise()  # Warm imports/TLS construction with a 16-byte synthetic body.
    size=SIZE;tracemalloc.start();result=await exercise();_,peak=tracemalloc.get_traced_memory();tracemalloc.stop()
    result.update(mode=MODE,python_peak_bytes=peak,scope='Synthetic 100 MiB Worker download proxy; ASGI sink discards bytes; no live media/device claim')
    print(json.dumps(result))
    if MODE=='after':assert peak<16*1024*1024 and result['maximum_asgi_chunk']<=65536

asyncio.run(main())
