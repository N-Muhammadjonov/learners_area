"""Actual authenticated ASGI grading requests on a fresh localhost database.

Only the external provider transport is synthetic (100 ms, no paid calls).
Compare the exact prior provider bridge with current admission, through the same
real auth, abuse limits, saved requests, grading normalization and persistence.
"""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import time
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg
import httpx
from app import main as core,db,ai_runtime,step23_writing_provider as writing
from app.security import issue_token,SESSION_COOKIE

async def main():
    dsn=os.environ['AI_RUNTIME_TEST_DATABASE_URL'];target=urlsplit(dsn)
    assert target.hostname in ('localhost','127.0.0.1') and target.path.startswith('/learners_ai_http_')
    os.environ.update(DATABASE_URL=dsn,RATE_LIMIT_BACKEND='postgres',AUTH_SECRET='isolated-ai-api-probe-only-key',PUBLIC_BASE_URL='http://ai.test')
    pool=await asyncpg.create_pool(dsn,min_size=1,max_size=5,command_timeout=20,statement_cache_size=0,init=db.initialize_connection)
    assert await pool.fetchval("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")==0,'fresh test database required'
    for file in sorted((Path(__file__).resolve().parents[1]/'migrations').glob('*.sql')):
        for statement in file.read_text().split('--> statement-breakpoint'):
            if statement.strip():await pool.execute(statement)
    users=[]
    for n in range(1,5):
        user={'id':UUID(int=2000+n),'name':'Isolated learner','role':'student','locale':'en','auth_version':0}
        await pool.execute("INSERT INTO users(id,name,email,role,account_status,locale) VALUES($1,$2,$3,'student','active','en')",user['id'],user['name'],f'isolated-{n}@example.test')
        users.append(issue_token(user))
    async def core_pool():return pool
    core.pool=core_pool
    state=ai_runtime.control.state();worker=core.control.start()
    spec=importlib.util.spec_from_file_location('app._ai_api_baseline',os.environ['AI_PROVIDER_BASELINE'])
    before=importlib.util.module_from_spec(spec);spec.loader.exec_module(before)
    assert before.INSTRUCTIONS==writing.INSTRUCTIONS and before.grade_system('task2')==writing.grade_system('task2')
    async def config():return {'id':'synthetic','model':'isolated','url':'https://synthetic.invalid','headers':{}}
    before.provider_spec=writing.provider_spec=config
    original_evaluate=writing.evaluate
    async def old_bridge(*args,**kwargs):return await before.evaluate(*args)
    result={'overallEstimate':7,'confidence':.8,'verdict':None,
      'criteria':[{'key':k,'label':label,'band':7,'limited':False,'note':None} for k,label in [
        ('task_response','Task Response'),('coherence_cohesion','Coherence & Cohesion'),('lexical_resource','Lexical Resource'),('grammatical_range_accuracy','Grammatical Range & Accuracy')]],
      'strengths':[],'weaknesses':[],'issues':[],'nextActions':[],'recommendedExercises':[]}
    calls=0
    async def provider(request):
        nonlocal calls
        assert request.url.host=='synthetic.invalid';calls+=1;await asyncio.sleep(.1)
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(result)}}]})
    original_client=httpx.AsyncClient
    def client(**kwargs):return original_client(**kwargs) if 'transport' in kwargs else original_client(transport=httpx.MockTransport(provider),**kwargs)
    httpx.AsyncClient=client;samples={'before':[],'after':[]};checks=0
    try:
        async with original_client(transport=httpx.ASGITransport(app=core.app),base_url='http://ai.test') as api:
            for n in range(60):
                pair={}
                for name in (['before','after'] if n%2 else ['after','before']):
                    writing.evaluate=old_bridge if name=='before' else original_evaluate
                    start=time.perf_counter()
                    response=await api.post('/api/writing/grade',headers={'Origin':'http://ai.test','Cookie':SESSION_COOKIE+'='+users[n%4]},
                      json={'taskType':'task2','question':f'Isolated academic question number {n}.','essay':'word '*60,'idempotencyKey':f'isolated-{name}-{n}'})
                    elapsed=(time.perf_counter()-start)*1000
                    assert response.status_code==200 and response.json().get('status')=='evaluated',response.text
                    if n>=10:samples[name].append(elapsed)
                    request_id=UUID(response.json()['id'])
                    saved=await pool.fetchrow('SELECT user_id,essay_text,status FROM writing_grade_requests WHERE id=$1',request_id)
                    assert saved['user_id']==UUID(int=2001+n%4) and saved['essay_text']=='word '*60 and saved['status']=='evaluated'
                    pair[name]=dict(await pool.fetchrow("SELECT user_id,overall_estimate,criteria,provider_type,fallback_used FROM evaluations WHERE source_type='writing_grade' AND source_id=$1",request_id))
                    checks+=1
                assert pair['before']==pair['after'];checks+=1
        measurement={name:{'samples':len(v),'p50_ms':round(sorted(v)[24],3),'p95_ms':round(sorted(v)[47],3)} for name,v in samples.items()}
        measurement['p95_change_percent']=round((measurement['after']['p95_ms']/measurement['before']['p95_ms']-1)*100,2)
        report={'result':'passed' if measurement['p95_change_percent']<=10 else 'failed','scope':'actual authenticated ASGI grade API, local PostgreSQL, synthetic provider 100ms',
          'http_checks':checks,'provider_calls':calls,'external_provider_calls':0,'measurement':measurement,'users':4,'warmup_pairs':10,'retained_pairs':50}
        print(json.dumps(report),flush=True)
        assert measurement['p95_change_percent']<=10,'actual grade API p95 gate'
    finally:
        writing.evaluate=original_evaluate;httpx.AsyncClient=original_client
        await ai_runtime.control.close(state);await pool.close()

asyncio.run(main())
