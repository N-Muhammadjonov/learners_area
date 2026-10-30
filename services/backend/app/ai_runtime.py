"""Bounded inline provider calls. Shared leases contain only HMAC bucket keys.

No detached jobs or automatic retries. A short request lease survives crashes;
its expiry permits explicit recovery, without claiming provider exactly-once billing.
"""
import asyncio
import copy
import hashlib
import json
import logging
import os
import time
import weakref
from collections import OrderedDict
from contextlib import asynccontextmanager
from dataclasses import dataclass,field

import httpx
import asyncpg
from . import rate_limit as limits

LOG=logging.getLogger('uvicorn.error')
LEASE_SECONDS=180
MAX_RESPONSE=200000

class ProviderBusy(Exception):pass

@dataclass
class State:
    flights:dict=field(default_factory=dict)
    cache:OrderedDict=field(default_factory=OrderedDict)
    cache_bytes:int=0
    store_lock:asyncio.Lock=field(default_factory=asyncio.Lock)
    store_connection:object=None

class Controller:
    def __init__(self):self.states=weakref.WeakKeyDictionary()
    def state(self):
        loop=asyncio.get_running_loop();reference=self.states.get(loop)
        state=reference() if reference else None
        if state is None:state=State();self.states[loop]=weakref.ref(state)
        return state

    async def store(self,query,*args,fetch=False):
        state=self.state()
        # A single dedicated operational connection avoids borrowing/resetting
        # academic clients. Only the two fixed budget statements use it.
        async with state.store_lock:
            if state.store_connection is None or state.store_connection.is_closed():
                from .db import connection_settings,connection_mode
                dsn=os.environ.get('DATABASE_URL')
                if not dsn:raise limits.RateLimitUnavailable('provider_budget_database_required')
                dsn,tls=connection_settings(dsn)
                state.store_connection=await asyncpg.connect(dsn,ssl=tls,timeout=8,command_timeout=5,
                    statement_cache_size=0,server_settings={'application_name':'learners-area-ai-budget'})
                LOG.info('AI budget connection ready: max=1 transport=%s verified_tls=%s',connection_mode(dsn),bool(tls and tls.check_hostname))
            con=state.store_connection
            return await con.fetch(query,*args) if fetch else await con.execute(query,*args)

    async def close(self,state=None):
        state=state or self.state()
        try:
            async with asyncio.timeout(5):
                async with state.store_lock:
                    if state.store_connection:await state.store_connection.close()
        except asyncio.CancelledError:
            if state.store_connection:state.store_connection.terminate()
            raise
        except Exception:
            if state.store_connection:state.store_connection.terminate()
        finally:state.store_connection=None

    async def call(self,key,work):
        state=self.state();now=time.monotonic()
        for old,(until,_,size) in list(state.cache.items()):
            if until<=now:state.cache_bytes-=size;del state.cache[old]
        if key in state.cache:return copy.deepcopy(state.cache[key][1])
        if key in state.flights:
            future,waiters=state.flights[key]
            if waiters>=16:raise ProviderBusy('duplicate_waiters_full')
            state.flights[key]=(future,waiters+1)
            try:return copy.deepcopy(await asyncio.shield(future))
            finally:
                if key in state.flights:state.flights[key]=(future,state.flights[key][1]-1)
        if len(state.flights)>=8:raise ProviderBusy('provider_admission_full')
        future=asyncio.get_running_loop().create_future();state.flights[key]=(future,0)
        try:
            result=await work()
            size=len(json.dumps(result,ensure_ascii=False).encode())
            if size<=MAX_RESPONSE:
                while state.cache and (len(state.cache)>=128 or state.cache_bytes+size>2*1024*1024):
                    _,(_,_,removed)=state.cache.popitem(last=False);state.cache_bytes-=removed
                state.cache[key]=(time.monotonic()+LEASE_SECONDS,result,size);state.cache_bytes+=size
            future.set_result(result)
            return copy.deepcopy(result)
        except BaseException as error:
            # Followers see the same failure; cancelling a follower cannot cancel
            # the inline owner. The owner is never converted to an untracked task.
            if not future.done():future.set_exception(error);future.exception()
            raise
        finally:state.flights.pop(key,None)

control=Controller()

@asynccontextmanager
async def admission(user_id,key):
    if user_id is None:raise ProviderBusy('provider_identity_required')
    state=control.state()  # Keep the operational connection alive through release.
    claims=[]
    requests=[('ai_provider_request',key),('ai_provider_hour','global'),
              ('ai_provider_user_hour',user_id),('ai_provider_user_active',user_id)]
    async def take(con=None):
        for name,identity in requests:
            r=await limits.reserve(name,identity,connection=con)
            if r.retry_after:raise ProviderBusy('provider_budget_full')
            claims.append(r)
        # Four independent leases avoid a fixed-window aggregate counter
        # resetting while late-starting calls are still active.
        for slot in range(4):
            r=await limits.reserve('ai_provider_active',str(slot),connection=con)
            if not r.retry_after:claims.append(r);break
        else:raise ProviderBusy('provider_budget_full')
    mode=limits.backend()
    try:
        async with asyncio.timeout(10):
            if mode=='memory':await take()
            else:
                args=[]
                for name,identity in requests+[('ai_provider_active',str(slot)) for slot in range(4)]:
                    capacity,window=limits._limits(name)
                    args.append((limits._bucket(name,identity),capacity,window))
                try:
                    rows=await control.store('SELECT * FROM public.la_claim_ai_provider_v1($1::text[],$2::int[],$3::int[])',
                                             *[list(values) for values in zip(*args)],fetch=True)
                    claims.extend(limits.Reservation(None,row['bucket_key'],row['reset_at'],'postgres',True) for row in rows)
                except asyncpg.RaiseError as error:
                    if error.message=='ai_provider_budget_full':raise ProviderBusy('provider_budget_full') from None
                    raise limits.RateLimitUnavailable('provider_budget_store_unavailable') from None
                except asyncpg.PostgresError:
                    raise limits.RateLimitUnavailable('provider_budget_store_unavailable') from None
    except BaseException:
        if mode=='memory':
            for claim in claims:await limits.release(claim)
        raise
    async def release_active():
        try:
            async with asyncio.timeout(5):
                if mode=='memory':
                    for claim in claims[-2:]:
                        if limits.BUCKETS.get(claim.bucket,(None,None))[1]==claim.window:limits.BUCKETS.pop(claim.bucket,None)
                else:
                    await control.store('''DELETE FROM public.api_rate_buckets b USING unnest($1::text[],$2::timestamptz[]) r(key,lease_until)
                            WHERE b.bucket_key=r.key AND b.reset_at=r.lease_until''',
                            [claim.bucket for claim in claims[-2:]],[claim.window for claim in claims[-2:]])
        except (Exception,asyncio.CancelledError):
            LOG.warning('AI active-slot release deferred to lease expiry')
    try:yield
    finally:
        # Keep request/hour reservations: an ambiguous timeout may have cost money.
        # Only active slots are released; generation-matched leases expire after a crash.
        await release_active()

async def request_json(user_id,url,headers,*,payload=None,data=None,files=None,timeout=20,max_bytes=MAX_RESPONSE,with_status=False):
    # Identity/configuration and every submitted byte participate in private
    # deduplication. No provider credentials or learner text enter the shared store.
    identity={'user':str(user_id),'url':url,'json':payload,'data':data,'timeout':timeout,'maxBytes':max_bytes}
    if files:identity['files']={name:[file[0],hashlib.sha256(file[1]).hexdigest(),file[2]] for name,file in files.items()}
    key=hashlib.sha256(json.dumps(identity,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    async def work():
        async with admission(user_id,key):
            try:
                async with asyncio.timeout(min(60,max(1,timeout))):
                    async with httpx.AsyncClient(timeout=timeout,follow_redirects=False,trust_env=False) as client:
                        async with client.stream('POST',url,headers=headers,json=payload,data=data,files=files) as response:
                            if response.status_code!=200:return response.status_code,None
                            body=bytearray()
                            async for chunk in response.aiter_bytes():
                                if len(body)+len(chunk)>max_bytes:return 200,None
                                body.extend(chunk)
                return 200,json.loads(body)
            except (TimeoutError,ValueError,TypeError,httpx.HTTPError):return 0,None
    try:result=await control.call(key,work)
    except ProviderBusy:result=(429,None)
    except (limits.RateLimitUnavailable,ConnectionError,OSError):result=(503,None)
    except TimeoutError:result=(0,None)
    return result if with_status else result[1] if result[0]==200 else None
