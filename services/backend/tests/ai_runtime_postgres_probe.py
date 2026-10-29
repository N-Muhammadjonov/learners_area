"""Disposable localhost PostgreSQL only; two OS workers, no AI network calls."""
import asyncio
import json
import importlib.util
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg
import httpx
from app import main as core,ai_runtime,rate_limit

DSN=os.environ['AI_RUNTIME_TEST_DATABASE_URL']
parsed=urlsplit(DSN)
assert parsed.hostname in ('localhost','127.0.0.1') and parsed.path.startswith('/learners_ai_'),'isolated localhost database required'
os.environ['RATE_LIMIT_BACKEND']='postgres'
os.environ['AUTH_SECRET']='isolated-ai-runtime-probe-only-key'
checks=0
def check(value,message):
    global checks
    assert value,message;checks+=1

async def connect():
    os.environ['DATABASE_URL']=DSN
    pool=await asyncpg.create_pool(DSN,min_size=1,max_size=5,command_timeout=5,statement_cache_size=0)
    async def get_pool():return pool
    core.pool=get_pool
    return pool

async def worker(number):
    pool=await connect();state=ai_runtime.control.state();print(json.dumps({'ready':True}),flush=True)
    assert (await asyncio.to_thread(sys.stdin.readline)).strip()=='go'
    finish=asyncio.Event();decided=asyncio.Event();results=[]
    async def attempt(n):
        try:
            async with ai_runtime.admission(UUID(int=number*100+n),f'worker-{number}-{n}'):
                results.append(True)
                if len(results)==4:decided.set()
                await finish.wait()
        except ai_runtime.ProviderBusy:
            results.append(False)
            if len(results)==4:decided.set()
    tasks=[asyncio.create_task(attempt(n)) for n in range(1,5)]
    await asyncio.wait_for(decided.wait(),10)
    print(json.dumps({'admitted':sum(results),'decisions':len(results),'pool_released':pool.get_idle_size()==pool.get_size() and not state.store_lock.locked()}),flush=True)
    assert (await asyncio.to_thread(sys.stdin.readline)).strip()=='release'
    finish.set();await asyncio.gather(*tasks);await ai_runtime.control.close(state);await pool.close()

async def benchmark():
    from app import step23_writing_provider as after
    spec=importlib.util.spec_from_file_location('app._ai_baseline',os.environ['AI_PROVIDER_BASELINE'])
    before=importlib.util.module_from_spec(spec);spec.loader.exec_module(before)
    check(before.INSTRUCTIONS==after.INSTRUCTIONS and before.grade_system('task2')==after.grade_system('task2'),'grading prompts unchanged')
    check(all(before.check_system(k)==after.check_system(k) for k in ('translation','activation','pattern')),'check prompts unchanged')
    async def config():return {'id':'synthetic','model':'isolated','url':'https://synthetic.invalid','headers':{}}
    before.provider_spec=after.provider_spec=config
    value={'overallEstimate':7,'confidence':.8,'verdict':None,'criteria':[{'key':'grammar','label':'Grammar','band':7,'limited':False,'note':None}],
           'strengths':[],'weaknesses':[],'issues':[],'nextActions':[],'recommendedExercises':[]}
    async def handler(request):
        await asyncio.sleep(.1)
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(value)}}]})
    original=httpx.AsyncClient;httpx.AsyncClient=lambda **kw:original(transport=httpx.MockTransport(handler),**kw)
    state=ai_runtime.control.state();samples={'before':[],'after':[]}
    try:
        for n in range(60):
            values={};order=['before','after'] if n%2 else ['after','before']
            for name in order:
                start=time.perf_counter();module=before if name=='before' else after
                values[name]=await module.evaluate('en','writing-check',{'answer':str(n)},module.INSTRUCTIONS,**({'user_id':UUID(int=9001)} if name=='after' else {}))
                if n>=10:samples[name].append((time.perf_counter()-start)*1000)
            check(values['before']==values['after'] and values['after'][1] is None,'provider values preserved')
    finally:httpx.AsyncClient=original
    result={name:{'samples':len(v),'p50_ms':round(sorted(v)[24],3),'p95_ms':round(sorted(v)[47],3)} for name,v in samples.items()}
    result['p95_change_percent']=round((result['after']['p95_ms']/result['before']['p95_ms']-1)*100,2)
    check(result['p95_change_percent']<=10,'equivalent provider p95 gate: '+json.dumps(result))
    return result

async def main():
    pool=await connect();state=ai_runtime.control.state()
    check((await pool.fetchval('SELECT current_database()')).startswith('learners_ai_'),'target identity')
    schema=Path(__file__).resolve().parents[1]/'migrations/0071_shared_abuse_limits.sql'
    await pool.execute(schema.read_text())
    await pool.execute((schema.parent/'0072_ai_provider_admission.sql').read_text())
    await pool.execute('TRUNCATE api_rate_buckets')  # This guarded test database contains no learner tables.
    function=await pool.fetchrow("""SELECT p.prosecdef,p.proconfig,
      EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') public_execute
      FROM pg_proc p WHERE p.oid='public.la_claim_ai_provider_v1(text[],integer[],integer[])'::regprocedure""")
    check(not function['prosecdef'] and not function['public_execute'],'invoker function denies public execution')
    check(function['proconfig']==['search_path=pg_catalog, public'],'fixed function search path')
    workers=[]
    try:
        for n in (1,2):
            child=await asyncio.create_subprocess_exec(sys.executable,__file__,'--worker',str(n),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
            workers.append(child)
        for child in workers:check(json.loads(await child.stdout.readline())['ready'],'worker ready')
        for child in workers:child.stdin.write(b'go\n');await child.stdin.drain()
        decisions=await asyncio.wait_for(asyncio.gather(*(child.stdout.readline() for child in workers)),15)
        rows=[json.loads(line) for line in decisions]
        check(sum(row['admitted'] for row in rows)==4,'exactly four global leases across OS workers')
        check(all(row['decisions']==4 and row['pool_released'] for row in rows),'no connection held during provider wait')
    finally:
        for child in workers:
            if child.returncode is None:child.stdin.write(b'release\n');await child.stdin.drain()
        for child in workers:
            _,errors=await asyncio.wait_for(child.communicate(),15)
            check(child.returncode==0,errors.decode())
    user=UUID(int=999)
    async with ai_runtime.admission(user,'user-first'):
        try:
            async with ai_runtime.admission(user,'user-second'):raise AssertionError('second active user request admitted')
        except ai_runtime.ProviderBusy:checks_before=checks;check(True,'per-user active lease')
        check(checks>checks_before,'per-user denial observed')
    check(await pool.fetchval('SELECT count(*) FROM api_rate_buckets WHERE bucket_key=$1',rate_limit._bucket('ai_provider_request','user-second'))==0,'rejected admission rolled back request claim')
    try:
        async with ai_runtime.admission(user,'user-first'):raise AssertionError('replayed shared request admitted')
    except ai_runtime.ProviderBusy:check(True,'request lease survives successful completion')
    slot=rate_limit._bucket('ai_provider_active','0')
    old=await pool.fetchval("INSERT INTO api_rate_buckets VALUES($1,1,NOW()-interval '2 hours') RETURNING reset_at",slot)
    async with ai_runtime.admission(user,'fresh-generation'):
        await pool.execute('DELETE FROM api_rate_buckets WHERE bucket_key=$1 AND reset_at=$2',slot,old)
        check(await pool.fetchval('SELECT used FROM api_rate_buckets WHERE bucket_key=$1',slot)==1,'stale generation cannot release new active lease')
        check(await pool.fetchval("SELECT reset_at>NOW()+interval '170 seconds' FROM api_rate_buckets WHERE bucket_key=$1",slot),'each active lease has a fresh full TTL')
    check(await pool.fetchval('SELECT count(*) FROM api_rate_buckets WHERE bucket_key=$1',slot)==0,'completed active lease removed')
    measurements=await benchmark() if os.getenv('AI_PROVIDER_BASELINE') else None
    global_hour=rate_limit._bucket('ai_provider_hour','global')
    await pool.execute('UPDATE api_rate_buckets SET used=2000 WHERE bucket_key=$1',global_hour)
    try:
        async with ai_runtime.admission(user,'hour-full'):raise AssertionError('exhausted hour budget admitted')
    except ai_runtime.ProviderBusy:check(True,'hour budget denial')
    check(await pool.fetchval('SELECT count(*) FROM api_rate_buckets WHERE bucket_key=$1',rate_limit._bucket('ai_provider_request','hour-full'))==0,'budget denial is transactional')
    print(json.dumps({'result':'passed','checks':checks,'workers':2,'concurrent_admitted':4,'per_user_active':1,
       'version':await pool.fetchval('SHOW server_version'),'database':'isolated localhost PostgreSQL server',
       'external_provider_calls':0,'synthetic_provider_delay_ms':100 if measurements else None,'measurements':measurements,'schema_migrations':[71,72]}))
    await ai_runtime.control.close(state);await pool.close()

asyncio.run(worker(int(sys.argv[2])) if '--worker' in sys.argv else main())
