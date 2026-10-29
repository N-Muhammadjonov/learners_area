"""Comparable sequential API samples over isolated PostgreSQL; no production load."""
import asyncio,json,os,time,bcrypt,hashlib
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
client=TestClient(application,base_url='http://pool.test')
r=client.post('/api/auth/login',json={'email':'pool@example.test','password':password})
assert r.status_code==200,r.text
measurements={};checks=1
for label,path in [('session','/api/frontend/session'),('reading_catalogue','/api/frontend/view?route=/app/reading/academic'),('dictionary_search_empty','/api/dictionary/search?q=unmatched&direction=EN')]:
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
print(json.dumps({'event':'done','checks':checks,'wire':{},'measurements':measurements}),flush=True)
