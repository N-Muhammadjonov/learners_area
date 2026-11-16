"""Repeatable Academy 2.0 measurements on a fresh localhost-only synthetic database.

This is an observation runner, not a passing production-capacity assertion. It
records missed objectives and admission rejections without hiding them as success.
"""
from __future__ import annotations

import asyncio
import base64
from collections import Counter,deque
import hashlib
import json
import os
from pathlib import Path
import platform
import resource
import subprocess
from time import perf_counter,process_time
from uuid import uuid4

import asyncpg
import httpx
import uvicorn

from academy_http import DSN,ROOT,STUDENTS,percentile,seed
from measurements import Measurements
from soak_scenarios import MixedPulse
from app import db,tuition_ledger as ledger,self_service_payments as payments
from app.asgi import application
from app.security import SESSION_COOKIE,issue_token

ORIGIN='http://127.0.0.1:4197'
WAITS: deque[float]=deque(maxlen=200000)
SQL: Counter[str]=Counter()
SQL_MS: deque[float]=deque(maxlen=200000)


class ObservedConnection(asyncpg.Connection):
    async def observed(self,name: str,*args,**kwargs):
        started=perf_counter()
        try:return await getattr(super(),name)(*args,**kwargs)
        finally:
            SQL[name]+=1
            SQL_MS.append((perf_counter()-started)*1000)

    async def fetch(self,*args,**kwargs):return await self.observed('fetch',*args,**kwargs)
    async def fetchrow(self,*args,**kwargs):return await self.observed('fetchrow',*args,**kwargs)
    async def fetchval(self,*args,**kwargs):return await self.observed('fetchval',*args,**kwargs)
    async def execute(self,*args,**kwargs):return await self.observed('execute',*args,**kwargs)


def measured(values,point: float) -> float | None:
    return percentile(list(values),point) if values else None


async def main() -> None:
    # Exact DSN + empty-database guard in seed: production hosts, existing databases,
    # production environment and inherited live merchant credentials are refused.
    assert os.environ.get('DATABASE_URL')==DSN and os.getenv('APP_ENV')=='test'
    assert os.getenv('LOAD_TEST_ONLY')=='1' and os.getenv('RATE_LIMIT_BACKEND')=='memory'
    assert not any(os.getenv(key) for key in ('CLICK_SECRET_KEY','PAYME_KEY','UZUM_API_KEY'))
    duration=float(os.getenv('ACADEMY_LOAD_SECONDS','5'))
    assert 1<=duration<=86400
    levels=[int(n) for n in os.getenv('ACADEMY_LOAD_LEVELS','100,250,500,1000,2000').split(',')]
    assert levels and all(1<=n<=2000 for n in levels)
    users,volume=await seed()
    actors={u['name']:u for u in users}
    owner,student=actors['owner1'],actors['student1']
    for key,value in {'PAYME_ENVIRONMENT':'sandbox','PAYME_SANDBOX_VERIFIED':'1','PAYME_LIVE_VERIFIED':'0',
        'PAYME_MERCHANT_ID':'isolated-load','PAYME_KEY':'isolated-load-key','PAYME_LOGIN':'Paycom',
        'PAYMENTS_RETURN_ORIGIN':'https://isolated.invalid'}.items():os.environ[key]=value
    conn=await asyncpg.connect(DSN)
    await db.initialize_connection(conn)
    try:
        # Populate the maximum default history page through the actual money service.
        async with conn.transaction():
            for n in range(10):
                await ledger.record_payment(conn,actor_user_id=owner['id'],student_user_id=student['id'],
                    amount_minor=1000,idempotency_key='isolated-load-cash-'+str(n))
                await payments.create_intent(conn,payer=student,student_id=student['id'],link_id=None,
                    body=payments.IntentCreate(amountMinor=137531,provider='payme',idempotencyKey=uuid4()))
        expected_due=(await ledger.student_position(conn,student['id']))['balanceDueMinor']
        version=await conn.fetchval('SHOW server_version')
        await conn.execute('ANALYZE')
    finally:await conn.close()
    original_create_pool=asyncpg.create_pool
    async def observed_pool(*args,**kwargs):
        return await original_create_pool(*args,**kwargs,connection_class=ObservedConnection)
    asyncpg.create_pool=observed_pool
    original_observe=db.BoundedPool._observe_acquire
    def observe(self,seconds):
        WAITS.append(seconds*1000)
        original_observe(self,seconds)
    db.BoundedPool._observe_acquire=observe
    cookies={name:SESSION_COOKIE+'='+issue_token(user) for name,user in actors.items()}
    source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip())
    receipt={'sourceCommit':source,'workingTreeModified':dirty,'verificationLevel':'LOCALLY_TESTED',
        'sourceSha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (
            Path(__file__),Path(__file__).with_name('measurements.py'),Path(__file__).with_name('soak_scenarios.py'),
            ROOT/'services/backend/app/self_service_payments.py',ROOT/'services/backend/app/self_service_payment_port.py',
            ROOT/'services/backend/app/academy_workbench.py',ROOT/'services/backend/app/academy_workbench_port.py',
            ROOT/'services/backend/app/tuition_ledger.py',ROOT/'services/backend/app/db.py')},
        'externalProviderVerified':False,'registeredStudents':STUDENTS,'fixture':volume,
        'environment':{'python':platform.python_version(),'postgres':version,'cpuCount':os.cpu_count(),
            'poolMax':db.pool_settings()[0],'requestBudget':os.getenv('REQUEST_BUDGET_ORDINARY','64'),
            'workers':1,'transport':'localhost HTTP; shared load generator/application/DB machine'},'levels':[]}
    print(json.dumps({'fixture':receipt['fixture'],'environment':receipt['environment']}),flush=True)
    server=uvicorn.Server(uvicorn.Config(application,host='127.0.0.1',port=4197,backlog=4096,access_log=False,log_config=None))
    active=asyncio.create_task(server.serve())
    auth='Basic '+base64.b64encode(b'Paycom:isolated-load-key').decode()
    pulse=None
    try:
        async with httpx.AsyncClient(base_url=ORIGIN,trust_env=False,timeout=30,
                limits=httpx.Limits(max_connections=2100,max_keepalive_connections=2100)) as api:
            for _ in range(100):
                try:
                    if (await api.get('/readyz')).status_code==200:break
                except httpx.ConnectError:pass
                await asyncio.sleep(.05)
            else:raise RuntimeError('isolated server did not become ready')
            if os.getenv('ACADEMY_LOAD_MIXED')=='1':
                pulse=MixedPulse(api,actors,cookies,auth,DSN)
                await pulse.prepare()
            async def read(index: int):
                kind=index%10;n=index%1000+1
                if kind<4:
                    who='student'+str(1 if kind==0 else index%STUDENTS+1);path='/api/finance/me/payments';name='student_payments'
                elif kind<6:
                    who='guardian'+str(n);child=actors['student'+str(n)]['id']
                    path=f'/api/guardian/children/{child}/payments';name='guardian_payments'
                elif kind==6:
                    who='student'+str(index%STUDENTS+1);path='/api/academy/journey';name='student_journey'
                elif kind==7:
                    who='teacher'+str(index%100+1);path='/api/staff/academy/today';name='teacher_today'
                else:
                    who='owner1';path='/api/staff/finance/debtors' if kind==8 else '/api/staff/finance/summary';name='debtor_queue' if kind==8 else 'owner_summary'
                started=perf_counter();reason=None
                try:
                    response=await api.get(path,headers={'cookie':cookies[who]});code=response.status_code
                    value=response.json()
                    if code==200:
                        if name.endswith('payments'):
                            expected=str(actors[who]['id']) if name=='student_payments' else str(child)
                            assert value['beneficiaryStudentId']==expected
                        if name=='student_payments' and who=='student1':
                            assert value['position']['balanceDueMinor']==expected_due and len(value['history'])==20
                    elif code>=500:reason=value.get('reason',value.get('error','unexplained'))
                except httpx.HTTPError as exc:code=0;reason=type(exc).__name__
                return name,code,(perf_counter()-started)*1000,reason

            for concurrency in levels:
                WAITS.clear();SQL_MS.clear();SQL.clear();cpu=process_time();started=perf_counter();deadline=started+duration
                lock_peak=0;event_loop_lag=deque(maxlen=200000);monitoring=True
                measurements=Measurements()
                async def monitor():
                    nonlocal lock_peak
                    observer=await asyncpg.connect(DSN)
                    try:
                        while monitoring:
                            expected=perf_counter()+.1;await asyncio.sleep(.1)
                            event_loop_lag.append(max(0,(perf_counter()-expected)*1000))
                            lock_peak=max(lock_peak,await observer.fetchval("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()"))
                    finally:await observer.close()
                async def heartbeat():
                    while monitoring:
                        await asyncio.sleep(45)
                        if monitoring:
                            print(json.dumps({'heartbeatSeconds':round(perf_counter()-started),
                                'requests':measurements.times.count,'status':dict(measurements.status),
                                'rssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                                'mixedPulses':pulse.pulses if pulse else 0}),flush=True)
                monitor_task=asyncio.create_task(monitor())
                heartbeat_task=asyncio.create_task(heartbeat())
                pulse_task=asyncio.create_task(pulse.run(deadline)) if pulse else None
                async def worker(i):
                    index=i
                    while perf_counter()<deadline:
                        measurements.add(*(await read(index)));index+=concurrency
                try:await asyncio.gather(*(worker(i) for i in range(concurrency)))
                finally:
                    monitoring=False
                    heartbeat_task.cancel()
                    await asyncio.gather(heartbeat_task,return_exceptions=True)
                    await monitor_task
                    if pulse_task:await pulse_task
                elapsed=perf_counter()-started
                result={**measurements.summary(),'concurrency':concurrency,'admissionSeconds':duration,'elapsedSeconds':round(elapsed,2),
                    'rps':round(measurements.times.count/elapsed,2),
                    'poolWaitP95Ms':measured(WAITS,.95),'poolLeasesSampled':len(WAITS),'sqlCalls':dict(SQL),'sqlP95Ms':measured(SQL_MS,.95),
                    'lockWaitersPeak':lock_peak,'eventLoopLagP95Ms':measured(event_loop_lag,.95),
                    'appAndClientCpuSeconds':round(process_time()-cpu,2),'appAndClientPeakRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}
                # Probe a real unrelated child at every level; never infer isolation from latency.
                forbidden=await api.get(f"/api/guardian/children/{actors['student1001']['id']}/payments",headers={'cookie':cookies['guardian1']})
                assert forbidden.status_code==403
                result['crossScopeDenied']=True;receipt['levels'].append(result)
                print(json.dumps(result),flush=True)
                assert (await api.get('/readyz')).status_code==200
                await asyncio.sleep(.25)
            if pulse:receipt['mixedWorkload']=await pulse.verify()
            # Callback burst uses actual auth, durable intent and idempotent settlement.
            headers={'cookie':cookies['student1'],'origin':ORIGIN}
            created=await api.post('/api/finance/me/intents',headers=headers,json={
                'amountMinor':137531,'provider':'payme','idempotencyKey':str(uuid4())})
            assert created.status_code==200,created.text
            order=created.json()
            async def rpc(method,params):
                return await api.post('/api/payments/callbacks/payme',headers={'authorization':auth},json={'id':1,'method':method,'params':params})
            import time
            prepared=await rpc('CreateTransaction',{'id':'isolated-burst','time':int(time.time()*1000),
                'amount':13753100,'account':{'order_id':order['intentId']}})
            assert prepared.json()['result']['state']==1
            begin=perf_counter()
            replies=await asyncio.gather(*(rpc('PerformTransaction',{'id':'isolated-burst'}) for _ in range(50)))
            acknowledged=sum(r.status_code==200 and r.json().get('result',{}).get('state')==2 for r in replies)
            assert acknowledged==50
            check=await asyncpg.connect(DSN);await db.initialize_connection(check)
            try:
                effects=await check.fetchval("SELECT count(*) FROM finance_journal_entries WHERE source_type='provider_payment'")
                expected_effects=2 if pulse else 1
                assert effects==expected_effects and await check.fetchval('SELECT count(*) FROM tuition_provider_events')==expected_effects
                assert (await ledger.journal_is_balanced(check))['balanced']
                receipt['callbackBurst']={'requests':50,'acknowledged':acknowledged,'journalEffects':effects,
                    'seconds':round(perf_counter()-begin,3),'balanced':True,'externalProviderVerified':False}
            finally:await check.close()
    finally:
        if pulse:pulse.close()
        server.should_exit=True;await active
        asyncpg.create_pool=original_create_pool;db.BoundedPool._observe_acquire=original_observe
    output=Path(os.getenv('ACADEMY_LOAD_RECEIPT',str(ROOT/'docs/verification/academy-ux/load-receipt.json')))
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'receipt':str(output),'callbackBurst':receipt['callbackBurst']}),flush=True)


if __name__=='__main__':asyncio.run(main())
