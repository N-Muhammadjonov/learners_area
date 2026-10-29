"""Comparable sequential API samples over isolated PostgreSQL; no production load."""
import asyncio,json,os,time,bcrypt,hashlib,math
from fastapi.testclient import TestClient
from stdio_postgres import Connection
from app import main as core,db as database
from app.asgi import application

os.environ.update(AUTH_SECRET='isolated-pool-latency-fixture-secret',APP_ENV='development',RATE_LIMIT_BACKEND='postgres',PUBLIC_AUTH_MODE='password')
os.environ.pop('CLOUDFLARE_ORIGIN_SECRET',None)

class ObservedConnection(Connection):
    queries=0
    def acquire(self,*,timeout=None):return self
    async def fetch(self,query,*args):
        self.queries+=1
        return await super().fetch(query,*args)

con=ObservedConnection()
client_pool=database.BoundedPool(con,5) if hasattr(database,'BoundedPool') else con
async def pool():return client_pool
core.pool=pool
uid='11111111-1111-4111-8111-111111111111';password='IsolatedPoolTest123!'
digest=bcrypt.hashpw(password.encode(),bcrypt.gensalt(rounds=4)).decode()
asyncio.run(con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,locale,onboarding_completed_at) VALUES($1,'Isolated learner','pool@example.test',$2,'student','active','en',now())",uid,digest))
release='rel-v1-'+'d'*24
asyncio.run(con.execute("INSERT INTO dictionary_releases(id,state,manifest,manifest_sha,validated_at,delivery) VALUES($1,'validated','{}'::jsonb,$2,now(),'legacy')",release,hashlib.sha256(b'{}').hexdigest()))
asyncio.run(con.execute("INSERT INTO dictionary_channels(name,active_release_id) VALUES('stable',$1)",release))
paired=os.environ.get('PAIR_REQUEST_BUDGET')=='1'
if paired:
    from app.asgi import dispatch
    from app.seo import IndexingPolicy
    from app.origin_boundary import OriginBoundary
    plain=IndexingPolicy(OriginBoundary(dispatch))
    selected={'budget':True}
    async def paired_application(scope,receive,send):
        await (application if selected['budget'] else plain)(scope,receive,send)
    client=TestClient(paired_application,base_url='http://pool.test')
    # Match Uvicorn: one persistent event loop and lifespan for both variants.
    # A context-free TestClient otherwise starts a new portal for every request.
    client.__enter__()
else:client=TestClient(application,base_url='http://pool.test')
r=client.post('/api/auth/login',json={'email':'pool@example.test','password':password})
assert r.status_code==200,r.text
measurements={};checks=1
if paired:
    from app.security import SESSION_COOKIE,issue_token
    tokens=[client.cookies.get(SESSION_COOKIE)]
    for n in range(2,5):
        row=asyncio.run(con.fetchrow("INSERT INTO users(id,name,email,password_hash,role,account_status,locale,onboarding_completed_at) VALUES($1,'Isolated learner',$2,$3,'student','active','en',now()) RETURNING id,role,name,locale,account_status,auth_version",f'11111111-1111-4111-8111-{n:012}',f'pool-{n}@example.test',digest))
        tokens.append(issue_token(dict(row)))
for label,path in [('session','/api/frontend/session'),('reading_catalogue','/api/frontend/view?route=/app/reading/academic'),('dictionary_search_empty','/api/dictionary/search?q=unmatched&direction=EN')]:
    if paired:
        paired_samples={'without_budget':[],'with_budget':[]};paired_queries={k:set() for k in paired_samples}
        # Four isolated learners keep the real 300/min per-user quota intact:
        # 90 warmup + 500 retained pairs gives at most 296 requests per learner.
        for n in range(590):
            client.cookies.set(SESSION_COOKIE,tokens[n%len(tokens)],domain='pool.test',path='/')
            order=[('without_budget',False),('with_budget',True)]
            if n%2:order.reverse()
            for variant,enabled in order:
                selected['budget']=enabled
                before=con.queries;start=time.perf_counter();response=client.get(path)
                elapsed=(time.perf_counter()-start)*1000
                assert response.status_code==200,(path,response.status_code,response.text)
                checks+=1
                if n>=90:
                    paired_samples[variant].append(elapsed);paired_queries[variant].add(con.queries-before)
        measurements[label]={variant:{'samples':len(values),'p50_ms':round(sorted(values)[math.ceil(len(values)*.5)-1],3),
            'p95_ms':round(sorted(values)[math.ceil(len(values)*.95)-1],3),'queries_per_request':sorted(paired_queries[variant])}
            for variant,values in paired_samples.items()}
        continue
    samples=[];queries=[]
    for n in range(130):
        before=con.queries;start=time.perf_counter();response=client.get(path)
        elapsed=(time.perf_counter()-start)*1000
        assert response.status_code==200,(path,response.status_code,response.text)
        checks+=1
        if n>=30:samples.append(elapsed);queries.append(con.queries-before)
    samples.sort()
    measurements[label]={'samples':len(samples),'p50_ms':round(samples[49],3),'p95_ms':round(samples[94],3),
                         'queries_per_request':sorted(set(queries))}
if paired:client.__exit__(None,None,None)
print(json.dumps({'event':'done','checks':checks,'wire':{},'measurements':measurements}),flush=True)
