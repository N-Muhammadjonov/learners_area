"""Compare Dashboard SQL snapshot with exact current-main behavior on PostgreSQL."""
import asyncio
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from uuid import UUID
from stdio_postgres import Connection,encode
from browser_fixtures import seed,id
from app import browser_activity as after
from app.browser_dashboard_snapshot import dashboard_snapshot

ROOT=Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix='dashboard-before-') as temporary:
    source=Path(temporary)/'browser_activity.py'
    source.write_bytes(subprocess.check_output(['git','show','2da939fea47b3bb688b99de4a1588cd0966d9518:services/backend/app/browser_activity.py'],cwd=ROOT))
    spec=importlib.util.spec_from_file_location('app._dashboard_before',source)
    before=importlib.util.module_from_spec(spec);spec.loader.exec_module(before)


class Observed(Connection):
    queries=0
    async def fetch(self,sql,*args):
        self.queries+=1;return await super().fetch(sql,*args)


con=Observed();checks=0;measurements=[]
def check(value):
    global checks
    assert value;checks+=1
def normalized(value):return json.dumps(value,sort_keys=True,default=encode)


async def compare(phase,*,degraded=False):
    for name in ('snapshot-user','other-student','teacher'):
        uid=UUID(id(name));start=con.queries;old=await before.dashboard(None,con,uid);old_queries=con.queries-start
        start=con.queries;new=await (after.dashboard(None,con,uid) if degraded else dashboard_snapshot(con,uid));new_queries=con.queries-start
        check(normalized(old)==normalized(new));check(degraded or new_queries==1)
        measurements.append({'phase':phase,'actor':name,'before_queries':old_queries,'after_queries':new_queries})


async def main():
    uid=id('snapshot-user')
    await con.execute("INSERT INTO users(id,name,email,role,account_status,locale) VALUES($1,'Synthetic Dashboard learner','dashboard@example.test','student','active','en')",uid)
    await seed(con,uid,'unused-synthetic-password')
    await compare('empty learner and peer histories')
    for n,name in enumerate(('snapshot-user','other-student')):
        user=id(name)
        await con.execute('INSERT INTO onboarding_profiles(user_id,target_band) VALUES($1,$2)',user,6.5+n)
        await con.execute("INSERT INTO reading_attempts(user_id,passage_id,status,score,total_questions,started_at,submitted_at) VALUES($1,$2,'completed',7,14,'2026-10-20 10:11:12.123456+05','2026-10-20 12:11:12.987654+05')",user,id('passage1'))
        await con.execute("INSERT INTO writing_submissions(user_id,prompt_id,content,word_count,updated_at) VALUES($1,$2,$3,20,'2026-10-21 10:11:12.123456+05')",user,id('writing-prompt'),'Private synthetic '+name)
        await con.execute("INSERT INTO evaluations(user_id,evaluation_type,source_type,source_id,provider_id,provider_display_name,provider_type,provider_version,prompt_version,rubric_version,checked_by_name,overall_estimate,weaknesses) VALUES($1,'writing','writing_submission',$2,'isolated','Synthetic','internal','v1','v1','v1','RIWI',$3,$4::jsonb)",user,id('evaluation-source-'+name),7.5+n,[{'skill':'writing','note':'Private synthetic '+name}])
        for step,status in enumerate(('not_started','in_progress','completed')):
            await con.execute("INSERT INTO assignments(title,created_by_user_id,target_user_id,status,due_at) VALUES($1,$2,$3,$4,'2026-10-24 12:34:56.123456+05'::timestamptz+make_interval(days=>$5))",f'Synthetic {name} {status}',id('teacher'),user,status,step)
        await con.execute("INSERT INTO activity_events(user_id,type,created_at) VALUES($1,'SYNTHETIC_LOAD_CHECK',now()),($1,'SYNTHETIC_LOAD_CHECK',now()-interval '1 day')",user)
        lexeme=await con.fetchval("INSERT INTO lexemes(term,sense_key,definition_en) VALUES($1,$1,'Synthetic definition') RETURNING id",'snapshot-'+name)
        await con.execute("INSERT INTO user_vocabulary(user_id,lexeme_id,next_review_at,created_at) VALUES($1,$2,now()-interval '1 hour','2026-10-22 10:11:12.123456+05')",user,lexeme)
    await compare('scoped counts, private evaluations, ordered due dates and streak')
    await con.execute("UPDATE writing_submissions SET updated_at='2026-10-23 12:34:56.987654-04' WHERE user_id=$1",uid)
    await compare('Writing becomes latest activity; timestamp precision and zone')
    await con.execute('ALTER TABLE evaluations RENAME TO isolated_temporarily_missing_evaluations')
    try:await compare('optional evaluation table outage',degraded=True)
    finally:await con.execute('ALTER TABLE isolated_temporarily_missing_evaluations RENAME TO evaluations')
    print(json.dumps({'event':'done','probeKind':'read_model','checks':checks,'measurements':measurements}),flush=True)


asyncio.run(main())
