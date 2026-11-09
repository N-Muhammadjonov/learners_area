"""Paired HTTP load, bounded clients, owned local PostgreSQL, no external target.

Example: python capacity.py --baseline <baseline backend> --output <outside repo>
This is a small synthetic database, not a production-capacity certification.
"""
import argparse
import asyncio
from collections import Counter,defaultdict
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
from uuid import UUID

import httpx
from isolated_db import OwnedDatabase,ROOT

def uid(kind,n):return str(UUID(hashlib.md5(f'phase2-{kind}-{n}'.encode()).hexdigest()))
def pct(v,p):
    a=sorted(v);return round(a[int((len(a)-1)*p)],3) if a else None

async def run(args):
    out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True);results=[]
    for stage,source in [('before',Path(args.baseline).resolve()),('after',ROOT/'services/backend')]:
        db=OwnedDatabase(out.parent);process=None;log=None
        try:
            await db.start()
            from app.security import issue_token,SESSION_COOKIE
            users=[{'id':uid('user',n),'writing':uid('writing',n)} for n in range(1,151)]
            cookies={u['id']:SESSION_COOKIE+'='+issue_token({'id':u['id'],'name':'Synthetic learner','role':'student','locale':'en','auth_version':0}) for u in users}
            with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
            secret=secrets.token_hex(24);base=f'http://127.0.0.1:{port}'
            env={**os.environ,'PYTHONPATH':os.pathsep.join([str(source),str(Path(__file__).parent)]),
                 'PHASE2_OWNED_LOAD':'1','PHASE2_METRICS_SECRET':secret,'PUBLIC_BASE_URL':base}
            log=(out/f'capacity-{stage}-server.log').open('w')
            process=subprocess.Popen([sys.executable,'-m','uvicorn','capacity_worker:application',
                '--host','127.0.0.1','--port',str(port),'--workers','1','--no-access-log','--log-level','warning'],env=env,stdout=log,stderr=log)
            async with httpx.AsyncClient(base_url=base,timeout=20,trust_env=False,limits=httpx.Limits(max_connections=600,max_keepalive_connections=500)) as client:
                for _ in range(100):
                    try:
                        if (await client.get('/healthz')).status_code==200:break
                    except httpx.HTTPError:pass
                    if process.poll() is not None:raise RuntimeError('Owned HTTP worker exited')
                    await asyncio.sleep(.1)
                else:raise RuntimeError('Owned HTTP worker not ready')
                async def metrics():return (await client.get('/__phase2_metrics',headers={'X-Phase2-Secret':secret})).json()
                for rep in range(args.repetitions):
                    for level in (1,10,25,50,100,150):
                        samples=[];by_api=defaultdict(list);statuses=Counter();reasons=Counter();timeouts=0;acks={};incomplete=0
                        async def request(u,n,measure=True):
                            nonlocal timeouts,incomplete
                            action=n%10;body=None;method='GET'
                            if action<2:kind='dashboard';path='/api/frontend/view?route=/app/dashboard&region=dashboard'
                            elif action<4:kind='reading';path='/api/frontend/view?route=/app/reading/academic'
                            elif action<6:kind='listening';path='/api/frontend/view?route=/app/listening/academic'
                            elif action==6:kind='vocabulary';path='/api/vocabulary?limit=50&offset=0'
                            elif action==7:kind='progress';path='/api/frontend/view?route=/app/progress&region=progressSummary'
                            elif action==8:kind='writing-save';path='/api/writing/submissions/'+u['writing'];method='PATCH';body={'content':f'Synthetic owner {u["id"]} revision {rep}-{level}-{n}'}
                            else:kind='presence';path='/api/presence';method='POST';body={}
                            began=time.perf_counter();status=0
                            try:
                                r=await client.request(method,path,json=body,headers={'Cookie':cookies[u['id']],'Origin':base})
                                status=r.status_code
                                if status>=400:
                                    try:reason=r.json().get('reason') or r.json().get('error') or str(status)
                                    except ValueError:reason=str(status)
                                    if measure:reasons[f'{kind}:{status}:{reason}']+=1
                                elif kind=='writing-save':acks[u['writing']]=(u['id'],body['content'])
                                elif r.headers.get('content-type','').startswith('application/json'):
                                    value=r.json()
                                    if 'unavailableRegions' in json.dumps(value):
                                        # Inspect actual non-empty lists, not the field's presence.
                                        def missing(v):
                                            if isinstance(v,dict):return bool(v.get('unavailableRegions')) or any(missing(x) for x in v.values())
                                            return isinstance(v,list) and any(missing(x) for x in v)
                                        if missing(value):incomplete+=1
                            except httpx.TimeoutException:
                                if measure:timeouts+=1;reasons[kind+':timeout']+=1
                            except httpx.HTTPError as e:
                                if measure:reasons[kind+':'+type(e).__name__]+=1
                            elapsed=(time.perf_counter()-began)*1000
                            if measure:samples.append(elapsed);by_api[kind].append(elapsed);statuses[str(status)]+=1
                        # Identical short warmup outside the measured period.
                        await asyncio.gather(*(request(u,i,False) for i,u in enumerate(users[:level])))
                        m0=await metrics();t0=time.monotonic();deadline=t0+args.seconds
                        async def learner(u,i):
                            n=i
                            while time.monotonic()<deadline:
                                at=time.monotonic();await request(u,n);n+=1
                                await asyncio.sleep(max(0,args.think-(time.monotonic()-at)))
                        await asyncio.gather(*(learner(u,i) for i,u in enumerate(users[:level])))
                        elapsed=time.monotonic()-t0;m1=await metrics()
                        import asyncpg
                        con=await asyncpg.connect(db.dsn);lost=0
                        for ident,(owner,text) in acks.items():
                            r=await con.fetchrow('SELECT user_id,content FROM writing_submissions WHERE id=$1',UUID(ident))
                            if not r or str(r['user_id'])!=owner or r['content']!=text:lost+=1
                        connections=await con.fetchval("SELECT count(*) FROM pg_stat_activity WHERE application_name='phase2-owned-api'")
                        await con.close()
                        waits=m1['poolWaitsMs'][len(m0['poolWaitsMs']):]
                        row={'stage':stage,'repetition':rep+1,'clients':level,'steadySeconds':args.seconds,'thinkSeconds':args.think,
                            'elapsedSeconds':elapsed,'requests':len(samples),'rps':len(samples)/elapsed,
                            'p50Ms':pct(samples,.5),'p95Ms':pct(samples,.95),'p99Ms':pct(samples,.99) if len(samples)>=100 else None,
                            'statuses':dict(statuses),'reasons':dict(reasons),'timeouts':timeouts,'partialUnavailableResponses':incomplete,
                            'perApi':{k:{'samples':len(v),'p50Ms':pct(v,.5),'p95Ms':pct(v,.95),'p99Ms':pct(v,.99) if len(v)>=100 else None} for k,v in by_api.items()},
                            'poolWaitP50Ms':pct(waits,.5),'poolWaitP95Ms':pct(waits,.95),'poolWaitP99Ms':pct(waits,.99) if len(waits)>=100 else None,
                            'backendConnectionsAtEnd':connections,'poolWaitersAtEnd':m1['poolPending'],
                            'rssStartBytes':m0['rssBytes'],'rssEndBytes':m1['rssBytes'],'cpuAverageCores':(m1['cpuSeconds']-m0['cpuSeconds'])/elapsed,
                            'acknowledgedDrafts':len(acks),'lostAcknowledgedDrafts':lost,'volume':db.volume,
                            'limits':'One HTTP worker, pool=5; uncapped shared local host and PostgreSQL 18.6; small synthetic DB; no paid AI or production requests'}
                        results.append(row);(out/'capacity-matrix.json').write_text(json.dumps(results,indent=2)+'\n')
                        print(json.dumps({k:row[k] for k in ('stage','repetition','clients','requests','p95Ms','statuses','lostAcknowledgedDrafts')}),flush=True)
                # Unpaced burst is distinct from the steady client matrix.
                async def burst(i):
                    u=users[i%150];t=time.perf_counter()
                    try:
                        r=await client.get('/api/frontend/view?route=/app/dashboard&region=dashboard',headers={'Cookie':cookies[u['id']]})
                        return {'status':r.status_code,'ms':(time.perf_counter()-t)*1000,'reason':r.json().get('reason') or r.json().get('error') if r.status_code>=400 else None}
                    except httpx.HTTPError as e:return {'status':0,'ms':(time.perf_counter()-t)*1000,'reason':type(e).__name__}
                burst_rows=await asyncio.gather(*(burst(i) for i in range(400)))
                await asyncio.sleep(2)
                recovery=[await burst(i) for i in range(40)]
                (out/f'capacity-{stage}-burst.json').write_text(json.dumps({'requests':400,'results':burst_rows,'recovery':recovery,'metrics':{k:v for k,v in (await metrics()).items() if k!='poolWaitsMs'}},indent=2)+'\n')
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:process.wait(timeout=30)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            if log:log.close()
            db.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--baseline',required=True);p.add_argument('--output',required=True)
    p.add_argument('--seconds',type=float,default=20);p.add_argument('--think',type=float,default=1)
    p.add_argument('--repetitions',type=int,default=3);a=p.parse_args()
    assert a.seconds>=5 and a.think>=.1 and 1<=a.repetitions<=5
    asyncio.run(run(a))
