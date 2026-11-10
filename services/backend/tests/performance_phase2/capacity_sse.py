"""Hold 150 real authorized SSE streams beside an ordinary 400-request burst.

Only an owned disposable PostgreSQL and loopback HTTP worker are used. Neither
production credentials nor an arbitrary target URL are accepted.
"""
import argparse
import asyncio
from collections import Counter
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import httpx
import asyncpg
from isolated_db import OwnedDatabase,ROOT
from capacity import uid,pct

async def run(args):
    out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True);reports=[]
    for stage,source in [('before',Path(args.baseline).resolve()),('after',ROOT/'services/backend')]:
        db=OwnedDatabase(out.parent);proc=None;log=None
        try:
            await db.start()
            from app.security import issue_token,SESSION_COOKIE
            cookies=[SESSION_COOKIE+'='+issue_token({'id':uid('user',n),'name':'Synthetic learner','role':'student','locale':'en','auth_version':0}) for n in range(1,151)]
            with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
            secret=secrets.token_hex(24);base=f'http://127.0.0.1:{port}'
            env={**os.environ,'PYTHONPATH':os.pathsep.join([str(source),str(Path(__file__).parent)]),'PHASE2_OWNED_LOAD':'1','PHASE2_METRICS_SECRET':secret,'PUBLIC_BASE_URL':base}
            log=(out/f'sse-{stage}-server.log').open('w')
            proc=subprocess.Popen([sys.executable,'-m','uvicorn','capacity_worker:application','--host','127.0.0.1','--port',str(port),'--no-access-log','--log-level','warning'],env=env,stdout=log,stderr=log)
            async with httpx.AsyncClient(base_url=base,trust_env=False,timeout=20,limits=httpx.Limits(max_connections=650,max_keepalive_connections=500)) as client:
                for _ in range(100):
                    try:
                        if (await client.get('/healthz')).status_code==200:break
                    except httpx.HTTPError:pass
                    if proc.poll() is not None:raise RuntimeError('Owned SSE worker exited')
                    await asyncio.sleep(.1)
                async def metrics():return (await client.get('/__phase2_metrics',headers={'X-Phase2-Secret':secret})).json()
                stop=asyncio.Event();handshakes=[];ready=0
                async def stream(i):
                    nonlocal ready
                    started=time.perf_counter()
                    try:
                        async with client.stream('GET','/api/auth/changes',headers={'Cookie':cookies[i]}) as r:
                            if r.status_code!=200:return {'status':r.status_code,'ready':False}
                            async for line in r.aiter_lines():
                                if line=='event: ready':
                                    ready+=1;handshakes.append((time.perf_counter()-started)*1000)
                                    await stop.wait();return {'status':200,'ready':True}
                                if line.startswith('event: session-revoked') or line.startswith('event: unavailable'):
                                    return {'status':200,'ready':False,'event':line[7:]}
                    except httpx.HTTPError as e:return {'status':0,'ready':False,'error':type(e).__name__}
                streams=[asyncio.create_task(stream(i)) for i in range(150)]
                for _ in range(200):
                    if ready==150 or all(t.done() for t in streams):break
                    await asyncio.sleep(.1)
                held=await metrics();con=await asyncpg.connect(db.dsn)
                connections=[dict(x) for x in await con.fetch("SELECT application_name,state,count(*)::int count FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid() GROUP BY 1,2")]
                async def ordinary(i):
                    at=time.perf_counter()
                    try:
                        r=await client.get('/api/frontend/view?route=/app/dashboard&region=dashboard',headers={'Cookie':cookies[i%150]})
                        reason=(r.json().get('reason') or r.json().get('error')) if r.status_code>=400 else None
                        return {'status':r.status_code,'ms':(time.perf_counter()-at)*1000,'reason':reason}
                    except httpx.HTTPError as e:return {'status':0,'ms':(time.perf_counter()-at)*1000,'reason':type(e).__name__}
                burst=await asyncio.gather(*(ordinary(i) for i in range(400)))
                stop.set();stream_results=await asyncio.wait_for(asyncio.gather(*streams),10)
                await asyncio.sleep(1)
                recovery=[await ordinary(i) for i in range(40)];released=await metrics();await con.close()
                row={'stage':stage,'syntheticOnly':True,'streamsRequested':150,'streamsReady':ready,'streamResults':dict(Counter(str(x) for x in stream_results)),
                    'handshakeP50Ms':pct(handshakes,.5),'handshakeP95Ms':pct(handshakes,.95),
                    'workerWhileHeld':held['worker'],'dbConnectionsWhileHeld':connections,
                    'burst':{'requests':400,'statuses':dict(Counter(x['status'] for x in burst)),'reasons':dict(Counter(x['reason'] for x in burst if x['reason'])),'p50Ms':pct([x['ms'] for x in burst],.5),'p95Ms':pct([x['ms'] for x in burst],.95),'p99Ms':pct([x['ms'] for x in burst],.99)},
                    'workerAfterDisconnect':released['worker'],'recoveryStatuses':dict(Counter(x['status'] for x in recovery)),
                    'rssHeldBytes':held['rssBytes'],'rssAfterBytes':released['rssBytes'],
                    'limits':'Local uncapped host; small synthetic DB; admission and asyncpg are real; not a production concurrency certificate'}
                reports.append(row);(out/'sse-capacity.json').write_text(json.dumps(reports,indent=2)+'\n');print(json.dumps(row),flush=True)
                if stage=='after':
                    sys.path.insert(0,str(ROOT/'scripts'))
                    from phase2_readonly_smoke import smoke
                    previous=os.environ.get('QA_READ_ONLY_COOKIE')
                    os.environ['QA_READ_ONLY_COOKIE']=cookies[0]
                    try:receipt=await smoke(base)
                    finally:
                        if previous is None:os.environ.pop('QA_READ_ONLY_COOKIE',None)
                        else:os.environ['QA_READ_ONLY_COOKIE']=previous
                    (out/'local-readonly-smoke.json').write_text(json.dumps(receipt,indent=2)+'\n')
        finally:
            if proc and proc.poll() is None:
                proc.terminate()
                try:proc.wait(timeout=30)
                except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=5)
            if log:log.close()
            db.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--baseline',required=True);p.add_argument('--output',required=True)
    asyncio.run(run(p.parse_args()))
