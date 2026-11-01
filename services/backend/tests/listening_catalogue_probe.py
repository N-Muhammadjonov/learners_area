"""Differential catalogue facts on isolated PostgreSQL, against exact current main."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from uuid import UUID

from stdio_postgres import Connection,encode
from app import browser_listening as after
from app.step17_listening_course_port import state_key,ORIGINAL1
from browser_fixtures import seed,id

ROOT=Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix='listening-catalogue-before-') as temporary:
    baseline=Path(temporary)/'browser_listening.py'
    supplied=os.environ.get('LISTENING_CATALOGUE_BASELINE')
    baseline.write_bytes(Path(supplied).read_bytes() if supplied else subprocess.check_output(
        ['git','show','2da939fea47b3bb688b99de4a1588cd0966d9518:services/backend/app/browser_listening.py'],cwd=ROOT))
    spec=importlib.util.spec_from_file_location('app._listening_catalogue_before',baseline)
    before=importlib.util.module_from_spec(spec);spec.loader.exec_module(before)


class Observed(Connection):
    queries=0
    async def fetch(self,query,*args):
        self.queries+=1;return await super().fetch(query,*args)


con=Observed();checks=0;measurements=[]
def check(value):
    global checks
    assert value;checks+=1
def normalized(value):return json.dumps(value,sort_keys=True,default=encode)


async def compare(label):
    for role,actor in [('student',id('catalogue-user')),('student',id('other-student')),('teacher',id('teacher'))]:
        for product in ('academic_full_test','general_section','question_type_practice'):
            user={'id':UUID(actor),'role':role}
            start=con.queries;old=await before.catalogue(con,user,product,{});old_count=con.queries-start
            start=con.queries;new=await after.catalogue(con,user,product,{});new_count=con.queries-start
            check(normalized(old)==normalized(new));check(new_count<=9)
            measurements.append({'phase':label,'role':role,'actor':actor,'product':product,'cards':len(new['cards']),'before_queries':old_count,'after_queries':new_count})


async def main():
    uid=id('catalogue-user')
    await con.execute("INSERT INTO users(id,name,email,role,account_status,locale) VALUES($1,'Synthetic learner','catalogue@example.test','student','active','en')",uid)
    await seed(con,uid,'synthetic-unused-password')
    for n in range(1,13):
        test=id('catalogue-test-'+str(n));collection='general' if n%2 else 'academic'
        p={'collection':collection,'sections':[] if n%3 else [{'number':2}],
           'audio':{'durationSec':120},'questions':[] if n%3 else [{'kind':'mcq'}],
           'keyword1':['synthetic'],'vocabulary':[{'term':'synthetic'}],
           'studyPack':{'activities':['exam','review','keyword1','recall','vocab','mcq','matching','completion','map','retry'],'recall':['synthetic']}}
        await con.execute("INSERT INTO listening_tests(id,created_by_user_id,title,audio_type,publication_state) VALUES($1,$2,$3,'audio','published')",test,id('teacher'),'Synthetic catalogue '+str(n))
        await con.execute("INSERT INTO listening_packages(test_id,source_id,payload,source_hash,audio_object_key) VALUES($1,$2,$3::jsonb,$4,'listening/fixture.mp3')",test,'catalogue:'+str(n),p,'a'*64)
        version=id('catalogue-version-'+str(n));draft=id('catalogue-draft-'+str(n))
        for number,v,status in [(1,version,'published'),(2,draft,'draft')]:
            await con.execute("""INSERT INTO content_versions(id,module,content_type,source_ref,version_no,status,title,content_hash,semantic_hash,answer_key_hash,target_type,target_id,content_snapshot)
              VALUES($1,'listening','full_test',$2,$3,$4,'Synthetic version',$5,$5,$5,'listening_test',$6,$7::jsonb)""",v,'catalogue:'+str(n),number,status,'a'*64,test,{'sectionNo':'3'})
        for q in range(1,4):
            qid=id(f'catalogue-question-{n}-{q}');v=version if n%3==0 else None if n%3==1 else draft
            await con.execute("""INSERT INTO listening_questions(id,test_id,"order",type,type_code,question_text,options,correct_answer,explanation,content_version_id)
              VALUES($1,$2,$3,'multiple_choice',$4,'Synthetic question','["A","B"]'::jsonb,'A','Synthetic explanation',$5)""",qid,test,q,'map_labeling' if q==3 else 'mcq_single',v)
            await con.execute("INSERT INTO listening_mcq_sessions(user_id,test_id,question_id,stage) VALUES($1,$2,$3,'reasoned')",uid,test,qid)
        for who,prefix in [(uid,'own'),(id('other-student'),'peer')]:
            completed=id(f'{prefix}-completed-{n}');active=id(f'{prefix}-active-{n}')
            await con.execute("INSERT INTO listening_attempts(id,user_id,test_id,status,score,total_questions,submitted_at,started_at) VALUES($1,$2,$3,'completed',1,3,NOW()-interval '1 day',NOW()-interval '2 days')",completed,who,test)
            await con.execute("INSERT INTO listening_attempts(id,user_id,test_id,status,total_questions) VALUES($1,$2,$3,'in_progress',3)",active,who,test)
            await con.execute("INSERT INTO listening_drafts(attempt_id,answers) VALUES($1,$2::jsonb)",active,{'1':'A','2':' ','3':''} if n%2 else [])
            await con.execute("INSERT INTO listening_answers(attempt_id,question_id,user_answer,is_correct) VALUES($1,$2,'B',false)",completed,id(f'catalogue-question-{n}-1'))
        for activity,practice in [(2,None),(3,None),(4,'retry'),(5,'matching')]:
            await con.execute("INSERT INTO listening_activity_runs(user_id,test_id,activity,answers,completed,score,total) VALUES($1,$2,$3,$4::jsonb,true,1,2)",uid,test,activity,{'_practice':practice,'1':'synthetic private answer'})
    await compare('version fallback, draft counts, activity stages, user scope')
    # Legacy runtime completion must remain distinct from full course completion.
    test=ORIGINAL1;source='listening-test-1'
    await con.execute("INSERT INTO listening_tests(id,created_by_user_id,title,audio_type,publication_state) VALUES($1,$2,'Synthetic original runtime','audio','published')",test,id('teacher'))
    await con.execute("INSERT INTO listening_packages(test_id,source_id,payload,source_hash,audio_object_key) VALUES($1,$2,$3::jsonb,$4,'listening/fixture.mp3')",test,source,{'collection':'academic','sections':[],'questions':[]},'a'*64)
    completed=id('runtime-completed')
    await con.execute("INSERT INTO listening_attempts(id,user_id,test_id,status,score,total_questions,submitted_at) VALUES($1,$2,$3,'completed',40,40,NOW())",completed,uid,test)
    for q in range(40):
        qid=id('runtime-question-'+str(q))
        await con.execute("INSERT INTO listening_questions(id,test_id,\"order\",type,type_code,question_text,correct_answer,explanation) VALUES($1,$2,$3,'short_answer','short_answer','Synthetic runtime question','fixture','Synthetic explanation')",qid,test,q)
        await con.execute("INSERT INTO listening_answers(attempt_id,question_id,user_answer,is_correct) VALUES($1,$2,'fixture',true)",completed,qid)
    values={state_key(source):json.dumps({'attemptStatus':'submitted','lastResults':[{'q':str(q),'ok':q%3!=0} for q in range(40)]})}
    await con.execute('INSERT INTO listening_authored_checkpoints(user_id,test_id,values) VALUES($1,$2,$3::jsonb)',uid,test,values)
    await compare('legacy submitted runtime')
    await con.execute("INSERT INTO listening_attempts(user_id,test_id,status,score,total_questions,submitted_at) VALUES($1,$2,'completed',0,40,NULL)",uid,test)
    await compare('legacy NULL submission ordering')
    # Material count growth must not increase the number of wire round trips.
    for n in range(20,80):
        test=id('catalogue-growth-'+str(n))
        await con.execute("INSERT INTO listening_tests(id,created_by_user_id,title,audio_type,publication_state) VALUES($1,$2,'Synthetic growth material','audio','published')",test,id('teacher'))
        await con.execute("INSERT INTO listening_packages(test_id,source_id,payload,source_hash,audio_object_key) VALUES($1,$2,$3::jsonb,$4,'listening/fixture.mp3')",test,'growth:'+str(n),{'collection':'academic','questions':[],'sections':[]},'a'*64)
    await compare('sixty additional materials')
    print(json.dumps({'event':'done','probeKind':'read_model','checks':checks,'measurements':measurements}),flush=True)


asyncio.run(main())
