"""Observation-only wrapper for an owned, disposable local HTTP load process."""
import json
import os
from pathlib import Path
import resource
import time
from collections import deque
from urllib.parse import urlsplit

p=urlsplit(os.environ.get('DATABASE_URL',''))
assert p.hostname=='127.0.0.1' and p.username=='phase2' and p.path=='/postgres'
assert os.environ.get('PHASE2_OWNED_LOAD')=='1' and os.environ.get('APP_ENV')=='test'

import asyncpg
waits=deque(maxlen=200000);pending=0;peak_pending=0
original=asyncpg.create_pool

class Acquire:
    def __init__(self,cm): self.cm=cm
    async def __aenter__(self):
        global pending,peak_pending
        pending+=1;peak_pending=max(pending,peak_pending);start=time.perf_counter()
        try:return await self.cm.__aenter__()
        finally:waits.append((time.perf_counter()-start)*1000);pending-=1
    async def __aexit__(self,*args):return await self.cm.__aexit__(*args)

class Pool:
    def __init__(self,raw):self.raw=raw
    def __getattr__(self,name):return getattr(self.raw,name)
    def acquire(self,*a,**k):return Acquire(self.raw.acquire(*a,**k))
    async def fetch(self,*a,**k):
        async with self.acquire() as c:return await c.fetch(*a,**k)
    async def fetchrow(self,*a,**k):
        async with self.acquire() as c:return await c.fetchrow(*a,**k)
    async def fetchval(self,*a,**k):
        async with self.acquire() as c:return await c.fetchval(*a,**k)
    async def execute(self,*a,**k):
        async with self.acquire() as c:return await c.execute(*a,**k)

async def create_pool(*a,**k):
    k['server_settings']={**k.get('server_settings',{}),'application_name':'phase2-owned-api'}
    return Pool(await original(*a,**k))
asyncpg.create_pool=create_pool
from app.asgi import application as actual
from starlette.responses import JSONResponse

def pct(v,p):
    a=sorted(v);return round(a[int((len(a)-1)*p)],3) if a else None

async def application(scope,receive,send):
    if scope['type']=='http' and scope['path']=='/__phase2_metrics':
        assert dict(scope['headers']).get(b'x-phase2-secret')==os.environ['PHASE2_METRICS_SECRET'].encode()
        from app.request_lifecycle import control
        from app import db
        r=resource.getrusage(resource.RUSAGE_SELF);state=control.state()
        rss=int(next(x.split()[1] for x in Path('/proc/self/status').read_text().splitlines() if x.startswith('VmRSS:')))*1024
        value={'rssBytes':rss,'cpuSeconds':r.ru_utime+r.ru_stime,'poolWaitsMs':list(waits),
               'poolPending':pending,'poolPendingPeak':peak_pending,
               'openFileDescriptors':len(list(Path('/proc/self/fd').iterdir())),
               'worker':{k:getattr(state,k) for k in ('active','streams','media','bulk')}}
        return await JSONResponse(value)(scope,receive,send)
    return await actual(scope,receive,send)
