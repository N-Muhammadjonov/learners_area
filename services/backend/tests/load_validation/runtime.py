"""Test-only observation/provider transport, mounted into an isolated container.

Never copied into the production image. Real authority, SQL, admission, grading,
serialization and writes remain in the unmodified application under test.
"""
import asyncio
from collections import deque
import json
import os
from pathlib import Path
import time
from safety import guard

guard()
media=Path('/tmp/load-media/listening/fixture.mp3');media.parent.mkdir(parents=True,exist_ok=True)
media.write_bytes(b'ID3'+b'x'*(1024*1024-3))
import asyncpg
import httpx
from starlette.responses import JSONResponse

waits=deque(maxlen=200000);sql_calls=0;waiters=0;peak_waiters=0;http_active=0;http_peak=0;provider_active=0;provider_peak=0;provider_calls=0
original_pool=asyncpg.create_pool
delay=float(os.getenv('LOAD_DB_LATENCY_MS','0'))/1000


class ObservedConnection(asyncpg.Connection):
    async def observed(self,method,*args,**kwargs):
        global sql_calls
        sql_calls+=1
        if delay:await asyncio.sleep(delay)
        return await method(*args,**kwargs)
    async def fetch(self,*a,**k):return await self.observed(super().fetch,*a,**k)
    async def fetchrow(self,*a,**k):return await self.observed(super().fetchrow,*a,**k)
    async def fetchval(self,*a,**k):return await self.observed(super().fetchval,*a,**k)
    async def execute(self,*a,**k):return await self.observed(super().execute,*a,**k)


class Acquire:
    def __init__(self,cm):self.cm=cm
    async def __aenter__(self):
        global waiters,peak_waiters
        waiters+=1;peak_waiters=max(peak_waiters,waiters);start=time.perf_counter()
        try:return await self.cm.__aenter__()
        finally:waits.append((time.perf_counter()-start)*1000);waiters-=1
    async def __aexit__(self,*args):return await self.cm.__aexit__(*args)


class Pool:
    def __init__(self,raw):self.raw=raw
    def __getattr__(self,name):return getattr(self.raw,name)
    def acquire(self,*args,**kwargs):return Acquire(self.raw.acquire(*args,**kwargs))
    async def fetch(self,*a,**k):
        async with self.acquire() as c:return await c.fetch(*a,**k)
    async def fetchrow(self,*a,**k):
        async with self.acquire() as c:return await c.fetchrow(*a,**k)
    async def fetchval(self,*a,**k):
        async with self.acquire() as c:return await c.fetchval(*a,**k)
    async def execute(self,*a,**k):
        async with self.acquire() as c:return await c.execute(*a,**k)


async def create_pool(*args,**kwargs):
    kwargs['connection_class']=ObservedConnection
    kwargs['server_settings']={**kwargs.get('server_settings',{}),'application_name':'learners-load-backend'}
    return Pool(await original_pool(*args,**kwargs))


asyncpg.create_pool=create_pool
from app.asgi import application as actual_application
from app import step23_writing_provider as writing


async def spec():return {'id':'synthetic','model':'isolated','url':'https://synthetic.invalid','headers':{}}
writing.provider_spec=spec
evaluation={'overallEstimate':7,'confidence':.8,'verdict':None,'criteria':[{'key':key,'label':label,'band':7,'limited':False,'note':None} for key,label in [('task_response','Task Response'),('coherence_cohesion','Coherence & Cohesion'),('lexical_resource','Lexical Resource'),('grammatical_range_accuracy','Grammatical Range & Accuracy')]],'strengths':[],'weaknesses':[],'issues':[],'nextActions':[],'recommendedExercises':[]}


async def provider(request):
    global provider_active,provider_peak,provider_calls
    assert request.url.host=='synthetic.invalid','outbound HTTP is forbidden in this isolated load fixture'
    provider_calls+=1;provider_active+=1;provider_peak=max(provider_peak,provider_active)
    try:
        await asyncio.sleep(.1)
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(evaluation)}}]})
    finally:provider_active-=1


original_client=httpx.AsyncClient
def client(**kwargs):return original_client(**{**kwargs,'transport':httpx.MockTransport(provider)})
httpx.AsyncClient=client


def percentile(values,p):
    values=sorted(values)
    return round(values[min(len(values)-1,int((len(values)-1)*p))],3) if values else 0


def metrics():
    rss=int(next(x.split()[1] for x in Path('/proc/self/status').read_text().splitlines() if x.startswith('VmRSS:')))*1024
    memory=int(Path('/sys/fs/cgroup/memory.current').read_text())
    cpu={k:int(v) for k,v in (line.split() for line in Path('/sys/fs/cgroup/cpu.stat').read_text().splitlines())}
    worker={}
    try:
        from app.request_lifecycle import control
        s=control.state();worker={k:getattr(s,k) for k in ('active','bulk','streams','media','probes')}
    except ImportError:pass
    return {'pool_wait_p50_ms':percentile(waits,.5),'pool_wait_p95_ms':percentile(waits,.95),'pool_acquisitions_sampled':len(waits),'sql_calls':sql_calls,'pool_waiters':waiters,'pool_waiters_peak':peak_waiters,'http_active':http_active,'http_peak':http_peak,'provider_active':provider_active,'provider_peak':provider_peak,'provider_calls':provider_calls,'rss_bytes':rss,'cgroup_memory_bytes':memory,'cpu_usage_usec':cpu['usage_usec'],'worker':worker}


async def application(scope,receive,send):
    global http_active,http_peak
    if scope['type']=='http' and scope['path']=='/__load_metrics':
        headers=dict(scope['headers'])
        assert headers.get(b'x-load-secret')==os.environ['LOAD_METRICS_SECRET'].encode()
        return await JSONResponse(metrics())(scope,receive,send)
    if scope['type']!='http':return await actual_application(scope,receive,send)
    http_active+=1;http_peak=max(http_peak,http_active)
    try:await actual_application(scope,receive,send)
    finally:http_active-=1
