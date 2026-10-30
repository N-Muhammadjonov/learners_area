"""Differential read-model/SQL acceptance over disposable PostgreSQL, not HTTP load."""
import ast
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import time
from datetime import datetime,timezone
from uuid import UUID

from stdio_postgres import Connection,encode
from app import main as core,browser_writing as writing,step37_reports as reports

ROOT=Path(__file__).resolve().parents[3]
BASE=Path(os.environ.get('API_QUERY_BASELINE',ROOT.parent/'task7-main-baseline/services/backend/app'))
def load(name,file):
    spec=importlib.util.spec_from_file_location('app.'+name,BASE/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
old_writing=load('_before_query_writing','browser_writing.py')
old_reports=load('_before_query_reports','step37_reports.py')

class Observed(Connection):
    queries=0
    async def fetch(self,query,*args):
        self.queries+=1;return await super().fetch(query,*args)

con=Observed();checks=0
def check(value,message):
    global checks
    assert value,message;checks+=1
def uid(n):return UUID(f'11111111-1111-4111-8111-{n:012}')
async def pool():return con
core.pool=pool
async def no_provider():return False
writing.ai_ready=old_writing.ai_ready=no_provider

def comparable(value):
    if isinstance(value,dict) and 'reportId' in value:value={k:v for k,v in value.items() if k!='reportId'}
    return json.dumps(value,sort_keys=True,default=encode)

async def evaluation(user,kind,id,band,fallback=False):
    await con.execute('''INSERT INTO evaluations(user_id,evaluation_type,source_type,source_id,
      provider_id,provider_display_name,provider_type,provider_version,prompt_version,rubric_version,
      checked_by_name,overall_estimate,fallback_used,created_at)
      VALUES($1,'writing',$2,$3,'isolated','Isolated','external','test','test','test','RIWI',$4,$5,'2026-10-20')''',user,kind,id,band,fallback)

async def seed():
    for n,role in [(1,'student'),(2,'student'),(3,'teacher'),(4,'owner'),(5,'admin')]:
        await con.execute("INSERT INTO users(id,name,email,role,account_status,created_at) VALUES($1,$2,$3,$4,'active','2026-10-01')",uid(n),'Isolated '+role,f'query-{n}@example.test',role)
    await con.execute('INSERT INTO teacher_student_links(teacher_user_id,student_user_id) VALUES($1,$2)',uid(3),uid(1))
    prompt=await con.fetchval("INSERT INTO writing_prompts(task_type,category,prompt,target_word_count,publication_state) VALUES('task2','Education','Isolated academic prompt',250,'published') RETURNING id")
    for n in range(50):
        id=await con.fetchval("""INSERT INTO writing_grade_requests(user_id,task_type,question_text,essay_text,word_count,status,idempotency_key,created_at)
          VALUES($1,'task2','Isolated question',$2,250,'evaluated',$3,'2026-10-20'::timestamptz+make_interval(secs=>$4)) RETURNING id""",uid(1),'word '*250,'query-'+str(n),n)
        await evaluation(uid(1),'writing_grade',id,7.5,fallback=n==0)
    for n in range(10):
        id=await con.fetchval("INSERT INTO writing_submissions(user_id,prompt_id,content,word_count,status,submitted_at,updated_at) VALUES($1,$2,$3,250,'evaluated','2026-10-20','2026-10-20'::timestamptz+make_interval(secs=>$4)) RETURNING id",uid(1),prompt,'word '*250,n)
        await evaluation(uid(1),'writing_submission',id,7)
    peer=await con.fetchval("INSERT INTO writing_grade_requests(user_id,task_type,question_text,essay_text,word_count,status,idempotency_key) VALUES($1,'task2','Private peer question','word',1,'evaluated','peer') RETURNING id",uid(2))
    await evaluation(uid(2),'writing_grade',peer,9)
    check(await writing.evaluations(con,uid(1),'writing_grade',[peer],True)=={},'foreign evaluation must remain private')
    for n in range(13):
        pack=await con.fetchval("INSERT INTO vocabulary_topic_packs(slug,source_ref,label_en,position,publication_state) VALUES($1,$1,$2,$3,$4) RETURNING id",'query-pack-'+str(n),'Pack '+str(n),n,'published' if n<12 else 'draft')
        lexeme=await con.fetchval("INSERT INTO lexemes(term,sense_key,part_of_speech,definition_en,translation_uz) VALUES($1,$2,'noun','Isolated definition','Sinov') RETURNING id",'query-word-'+str(n),f'query-word-{n}|noun|isolated definition')
        await con.execute('INSERT INTO vocabulary_topic_pack_words(pack_id,lexeme_id,position) VALUES($1,$2,0)',pack,lexeme)
    check(len(await writing.packs(con))==12,'draft pack must remain excluded')

async def measure(before,after):
    samples={k:[] for k in ('before','after')};counts={k:set() for k in samples};expected=None
    for n in range(145):
        order=[('before',before),('after',after)]
        if n%2:order.reverse()
        for name,fn in order:
            start_count=con.queries;start=time.perf_counter();value=await fn();elapsed=(time.perf_counter()-start)*1000
            normalized=comparable(value)
            if expected is None:expected=normalized
            check(normalized==expected,'read-model values changed')
            if n>=20:samples[name].append(elapsed);counts[name].add(con.queries-start_count)
    return {name:{'samples':len(values),'p50_ms':round(sorted(values)[62],3),'p95_ms':round(sorted(values)[118],3),
                  'queries_per_call':sorted(counts[name])} for name,values in samples.items()}

def presence_sql(path):
    tree=ast.parse(path.read_text());fn=next(n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='presence')
    return next(n.value for n in ast.walk(fn) if isinstance(n,ast.Constant) and isinstance(n.value,str) and 'INSERT INTO activity_events' in n.value)

async def presence():
    before=presence_sql(BASE/'main.py');after=presence_sql(ROOT/'services/backend/app/main.py');proof={}
    async with con.transaction():
        for name,age in [('fresh',0),('active',30),('new_visit',120)]:
            await con.execute("DELETE FROM activity_events WHERE id=md5('site-presence:'||$1::text)::uuid",str(uid(1)))
            await con.execute("""INSERT INTO activity_events(id,user_id,type,payload,created_at)
              VALUES(md5('site-presence:'||$1::text)::uuid,$1::uuid,'SITE_PRESENCE',
              '{"since":"2026-10-01","visitStartedAt":"2026-10-20","visitSeconds":12,"totalSeconds":100}',NOW()-make_interval(secs=>$2))""",str(uid(1)),age)
            await con.execute('SAVEPOINT compare_presence')
            await con.execute(before,str(uid(1)))
            old=await con.fetchrow("SELECT payload,created_at FROM activity_events WHERE id=md5('site-presence:'||$1::text)::uuid",str(uid(1)))
            await con.execute('ROLLBACK TO SAVEPOINT compare_presence')
            await con.execute(after,str(uid(1)))
            new=await con.fetchrow("SELECT payload,created_at FROM activity_events WHERE id=md5('site-presence:'||$1::text)::uuid",str(uid(1)))
            check(old==new,'presence duration/visit semantics changed: '+name)
            await con.execute('RELEASE SAVEPOINT compare_presence')
        plans={}
        for name,sql in [('before',before),('after',after)]:
            plan=await con.fetchval('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,str(uid(1)))
            plans[name]=plan[0] if isinstance(plan,list) else json.loads(plan)[0]
        check(plans['before']['Plan']['Conflicting Tuples']==1,'baseline must reach conflict locking')
        check(plans['after']['Plan']['Conflicting Tuples']==0,'fresh heartbeat must bypass conflict locking')
        proof={'fresh_conflicting_tuples':{name:p['Plan']['Conflicting Tuples'] for name,p in plans.items()},
               'isolated_plans':plans,'presence_is_study_time':False}
    return proof

async def main():
    await seed();measurements={};actor={'id':uid(1),'role':'student'}
    check(await reports.authorize(con,actor,{'scope':'student','subject':str(uid(2))})==404,'student cannot select a peer')
    check(await reports.authorize(con,{'id':uid(3),'role':'teacher'},{'scope':'student','subject':str(uid(2))})==404,'teacher cannot select an unlinked learner')
    check(await reports.authorize(con,{'id':uid(5),'role':'admin'},{'scope':'student','subject':str(uid(1))})==403,'admin cannot access academic reports')
    check(isinstance(await reports.authorize(con,{'id':uid(3),'role':'teacher'},{'scope':'student','subject':str(uid(1))}),dict),'teacher can select an assigned learner')
    for name,path,q in [('writing_grade','/app/writing',{'tab':'grade'}),('writing_history','/app/writing/history',{})]:
        measurements[name]=await measure(lambda:old_writing.read(None,actor,path,q,None),lambda:writing.read(None,actor,path,q,None))
    measurements['vocabulary_packs']=await measure(lambda:old_writing.packs(con),lambda:writing.packs(con))
    now=datetime(2026,10,29,tzinfo=timezone.utc);period=reports.period_window('custom',now,'2026-10-01','2026-10-28')
    for scope,principal in [({'kind':'student','subjectId':str(uid(1)),'subjectName':'Isolated student'},actor),
                  ({'kind':'teacher','teacherId':str(uid(3))},{'id':uid(3),'role':'teacher'}),
                  ({'kind':'owner'},{'id':uid(4),'role':'owner'}),({'kind':'operations'},{'id':uid(5),'role':'admin'})]:
        old=await old_reports.snapshot(con,scope,period,principal,now);new=await reports.snapshot(con,scope,period,principal,now)
        check(comparable(old)==comparable(new),'report scope/metrics/provenance changed: '+scope['kind'])
    scope={'kind':'student','subjectId':str(uid(1)),'subjectName':'Isolated student'}
    measurements['student_report']=await measure(lambda:old_reports.snapshot(con,scope,period,actor,now),lambda:reports.snapshot(con,scope,period,actor,now))
    measurements['presence']=await presence()
    print(json.dumps({'event':'done','checks':checks,'probeKind':'read_model','wire':{},'measurements':measurements}),flush=True)

asyncio.run(main())
