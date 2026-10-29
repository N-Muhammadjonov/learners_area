"""Shared limiter acceptance against a disposable PostgreSQL engine and actual ASGI."""
import asyncio,json,os,sys,time,math,bcrypt
from uuid import UUID
from pathlib import Path
import httpx
from fastapi.testclient import TestClient
from stdio_postgres import Connection
from app import main as core,rate_limit as limits
from app.asgi import application

os.environ.update(AUTH_SECRET='isolated-shared-rate-test-key-123456',RATE_LIMIT_BACKEND='postgres',APP_ENV='development',PUBLIC_AUTH_MODE='password',PUBLIC_BASE_URL='http://limits.test')
os.environ.pop('CLOUDFLARE_ORIGIN_SECRET',None)
con=Connection()
async def pool():return con
core.pool=pool
checks=0

def check(value,message):
    global checks
    assert value,message
    checks+=1

def sql(q,*args):return asyncio.run(con.execute(q,*args))
def scalar(q,*args):return asyncio.run(con.fetchval(q,*args))

a=Connection();b=Connection()
async def concurrent():return await asyncio.gather(*[limits.reserve('login_account','same-material',connection=a if n%2 else b) for n in range(40)])
slots=asyncio.run(concurrent())
check(sum(s.retry_after is None for s in slots)==8,'atomic admission across connections')
check(all(1<=s.retry_after<=900 for s in slots if s.retry_after),'bounded server Retry-After')
limits.BUCKETS.clear()
check(asyncio.run(limits.async_counter('login_account','same-material',True,connection=b)) is not None,'restart does not reset shared counter')
check(scalar('SELECT used FROM api_rate_buckets WHERE bucket_key=$1',limits._bucket('login_account','same-material'))==8,'denied calls do not inflate stored usage')
check(scalar("SELECT relrowsecurity FROM pg_class WHERE oid='api_rate_buckets'::regclass") is True,'counter table RLS')
check(scalar("SELECT bool_and(bucket_key~'^[a-f0-9]{64}$') FROM api_rate_buckets") is True,'HMAC-only identities')

limits.RULES['probe_window']=(2,60)
first=asyncio.run(limits.reserve('probe_window','expiry',connection=con))
check(first.retry_after is None,'first slot')
check(asyncio.run(limits.async_counter('probe_window','expiry',True,connection=con)) is None,'second slot')
check(asyncio.run(limits.async_counter('probe_window','expiry',True,connection=con)) is not None,'third blocked')
sql("UPDATE api_rate_buckets SET reset_at=statement_timestamp()-interval '1 second' WHERE bucket_key=$1",first.bucket)
new=asyncio.run(limits.reserve('probe_window','expiry',connection=con))
check(new.retry_after is None,'expired window resets')
asyncio.run(limits.release(first,connection=con))
asyncio.run(limits.async_reset('probe_window','expiry',connection=con,window=first.window))
check(scalar('SELECT used FROM api_rate_buckets WHERE bucket_key=$1',first.bucket)==1,'old completion cannot release/reset new window')
for n in range(20):sql("INSERT INTO api_rate_buckets(bucket_key,used,reset_at) VALUES($1,1,statement_timestamp()-interval '2 hours')",limits._bucket('probe_window','expired:'+str(n)))
asyncio.run(limits.reserve('probe_window','cleanup',connection=con))
check(scalar("SELECT count(*)::int FROM api_rate_buckets WHERE reset_at<statement_timestamp()-interval '1 hour'")==12,'bounded expiry cleanup')

uid=UUID('22222222-2222-4222-8222-222222222222');password='IsolatedPassword123!'
sql("INSERT INTO users(id,name,email,password_hash,role,account_status,locale) VALUES($1,'Isolated learner','limits@example.test',$2,'student','active','en')",uid,bcrypt.hashpw(password.encode(),bcrypt.gensalt(rounds=4)).decode())
c=TestClient(application,base_url='http://limits.test')
os.environ['RATE_LIMIT_LOGIN_IP']='2'
check(c.post('/api/auth/login',json={'email':'limits@example.test','password':'wrong-password'}).status_code==401,'failed login')
for n in range(6):check(c.post('/api/auth/login',json={'email':'limits@example.test','password':password}).status_code==200,'successful shared-NAT login '+str(n))
check(scalar('SELECT used FROM api_rate_buckets WHERE bucket_key=$1',limits._bucket('login_ip','unknown'))==1,'success releases own slot without clearing failed IP attempts')
os.environ.pop('RATE_LIMIT_LOGIN_IP')

# Reserve the account before bcrypt even when simultaneous requests use distinct IPs.
os.environ['RATE_LIMIT_LOGIN_ACCOUNT']='3';original=bcrypt.checkpw;calls=[]
def bad_password(*args):calls.append(True);return False
bcrypt.checkpw=bad_password
async def burst():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application),base_url='http://limits.test') as client:
        return await asyncio.gather(*[client.post('/api/auth/login',json={'email':'parallel@example.test','password':'wrong-password'}) for _ in range(12)])
try:responses=asyncio.run(burst())
finally:bcrypt.checkpw=original
check(sum(r.status_code==401 for r in responses)==3,'only three password checks admitted')
check(len(calls)==3,'parallel check cannot bypass account reservation')
check(sum(r.status_code==429 for r in responses)==9,'parallel overflow rejected')
check(all(1<=int(r.headers['retry-after'])<=900 for r in responses if r.status_code==429),'HTTP Retry-After')
os.environ.pop('RATE_LIMIT_LOGIN_ACCOUNT')

# Real positive application flow remains usable; burst quota uses durable user ID.
os.environ['RATE_LIMIT_AI_EVALUATION']='2'
asyncio.run(limits.async_counter('evaluation',str(uid),True,connection=con))
for n in range(2):check(c.post('/api/writing/grade',json={}).status_code==400,'valid rate slot reaches input validation')
r=c.post('/api/writing/grade',json={})
check(r.status_code==429 and int(r.headers['retry-after'])>0,'AI admission quota uses shared store')
os.environ.pop('RATE_LIMIT_AI_EVALUATION')

# Replay is additive, including when the Supabase browser roles exist.
for role in ('anon','authenticated'):
    sql("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='"+role+"') THEN CREATE ROLE "+role+" NOLOGIN; END IF; END $$")
before=scalar("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY bucket_key)::text) FROM api_rate_buckets t")
sql(Path('migrations/0071_shared_abuse_limits.sql').read_text())
check(scalar("SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY bucket_key)::text) FROM api_rate_buckets t")==before,'migration replay preserves operational counters')
check(scalar('SELECT count(*)::int FROM users')==1,'migration replay preserves learner records')
for role in ('anon','authenticated'):
    check(scalar("SELECT NOT has_table_privilege($1,'api_rate_buckets','SELECT,INSERT,UPDATE,DELETE')",role) is True,'browser role cannot access counters: '+role)

if os.getenv('RATE_LIMIT_MEASURE')=='1':
    # Paired mechanism comparison, not a production capacity measurement.
    # Ordinary navigation must retain the same database work in either mode.
    timings={mode:[] for mode in ('memory','postgres')};queries={mode:[] for mode in timings}
    original_fetch=con.fetch
    count=0
    async def counted_fetch(query,*args):
        global count
        if 'api_rate_buckets' in query:count+=1
        return await original_fetch(query,*args)
    con.fetch=counted_fetch
    try:
        for n in range(110):
            for mode in (('memory','postgres') if n%2 else ('postgres','memory')):
                os.environ['RATE_LIMIT_BACKEND']=mode;start=time.perf_counter();before=count
                response=c.get('/api/frontend/session')
                check(response.status_code==200,'normal authenticated navigation')
                if n>=10:
                    timings[mode].append((time.perf_counter()-start)*1000)
                    queries[mode].append(count-before)
    finally:
        con.fetch=original_fetch;os.environ['RATE_LIMIT_BACKEND']='postgres'
    def percentiles(samples):
        ordered=sorted(samples)
        return {'p50_ms':round(ordered[math.ceil(len(ordered)*.5)-1],3),'p95_ms':round(ordered[math.ceil(len(ordered)*.95)-1],3),'samples':len(ordered)}
    measurements={'scenario':'authenticated frontend session, alternating order, 10 warmups per mode','memory':percentiles(timings['memory']),'postgres':percentiles(timings['postgres']),'extra_rate_queries':{mode:sum(queries[mode]) for mode in queries}}
    check(count==0,'normal authenticated navigation has no rate-store queries')

original_pool=core.pool
async def offline():raise ConnectionError('isolated store outage')
core.pool=offline
try:
    check(c.get('/api/version').status_code==200,'ordinary endpoint has no extra limiter DB call')
    check(c.post('/api/auth/login',json={'email':'unavailable@example.test','password':password}).status_code==503,'limiter outage fails closed')
finally:core.pool=original_pool
print(json.dumps({'event':'done','checks':checks,'wire':{},'result':'passed',**({'measurements':measurements} if os.getenv('RATE_LIMIT_MEASURE')=='1' else {})}),flush=True)
