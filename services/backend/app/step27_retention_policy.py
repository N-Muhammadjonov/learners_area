"""Owner-only DataRetentionService policy (services/retention.ts).

Each work table is fixed in server code. Preview never deletes. Execution is
serialized with a transaction-scoped advisory lock; storage references are
checked before an object is removed, and failed removals stay retryable.
"""
from __future__ import annotations
import calendar,json,os,re
from datetime import datetime,timezone,timedelta
from fastapi import APIRouter,Request
from . import main as core
from .step19_storage import delete_object
router=APIRouter()

OLD_WORK=[('writing_submissions','greatest(t.created_at,t.updated_at,t.submitted_at)',['writing_submission'],'writing'),
 ('reading_attempts','greatest(t.started_at,t.submitted_at)',['reading_attempt'],'reading'),
 ('listening_attempts','greatest(t.started_at,t.submitted_at)',['listening_attempt'],'listening'),
 ('grammar_attempts','t.attempted_at',['grammar_attempt'],'grammar'),
 ('vocabulary_usages','t.created_at',['vocabulary_usage'],'vocabulary'),
 ('assignment_responses','greatest(t.created_at,t.updated_at)',['assignment'],'assignments'),
 ('typing_runs','t.created_at',[],'typing'),
 ('mock_attempts','greatest(t.started_at,t.finished_at)',['mock_attempt'],'mocks'),
 ('speaking_attempts','greatest(t.created_at,t.submitted_at)',['speaking_attempt'],'speaking')]
ACTIVITY_SOURCES=[('user_vocabulary','greatest(a.created_at,a.last_reviewed_at)','true'),
 ('vocab_point_events','a.created_at',"a.kind in ('new_word','revision','game_answer','sentence')"),
 ('activity_events','a.created_at',"a.type = 'VOCAB_GAME_PRACTICED'"),
 ('vocabulary_usages','a.created_at','length(trim(a.sentence)) > 0'),
 ('reading_attempts','a.submitted_at',"a.status = 'completed'"),
 ('listening_attempts','a.submitted_at',"a.status = 'completed'"),
 ('listening_mcq_sessions','a.updated_at',"a.stage <> 'listen'"),
 ('writing_submissions','greatest(a.submitted_at,a.updated_at)','length(trim(a.content)) > 0'),
 ('typing_runs','a.created_at','a.typed_chars > 0'),
 ('upload_intents','greatest(a.finalized_at,a.used_at)',"a.purpose = 'speaking_recording' and a.status in ('finalized', 'attached')"),
 ('speaking_attempts','a.submitted_at','a.submitted_at is not null'),
 ('grammar_attempts','a.attempted_at','true'),
 ('assignment_responses','a.updated_at','length(trim(a.content)) > 0'),
 ('lesson_progress','a.completed_at',"a.state = 'completed'"),
 ('video_lesson_progress','a.updated_at',"a.watched_seconds > 0 or coalesce(a.answers, '{}'::jsonb) <> '{}'::jsonb or length(trim(coalesce(a.response_text, '') || coalesce(a.summary_text, ''))) > 0"),
 ('live_class_attendance','a.joined_at','true'),
 ('mock_attempts','a.finished_at','a.finished_at is not null')]

def config():
    def num(key,fallback):
        raw=os.getenv(key)
        if not raw:return fallback
        m=re.match(r'^\s*([+-]?\d+)',raw)
        return int(m.group(1)) if m and int(m.group(1))>0 else fallback
    return {'inactiveStudentMonths':num('RETENTION_INACTIVE_STUDENT_MONTHS',6),
       'rawEventMonths':num('RETENTION_RAW_EVENT_MONTHS',2),
       'structuredResultMonths':num('RETENTION_STRUCTURED_MONTHS',18),
       'auditMonths':num('RETENTION_AUDIT_MONTHS',18),
       'generatedExportDays':num('RETENTION_EXPORT_DAYS',7),
       'batchSize':min(5000,num('RETENTION_BATCH_SIZE',500))}

def months_ago(months,now):
    month=now.year*12+(now.month-1)-months
    year,m=divmod(month,12)
    return now.replace(year=year,month=m+1,day=min(now.day,calendar.monthrange(year,m+1)[1]))

async def batched(con,select_sql,args,table,cond_sql,cutoff,dry,size):
    affected=0
    for _ in range(1000):
        found=await con.fetch(select_sql,*args,size)
        if not found:break
        ids=[r['id'] for r in found]
        affected+=len(ids)
        if dry:break
        await con.execute(f'DELETE FROM {table} t WHERE t.id = ANY($1::uuid[]) AND ({cond_sql})',ids,cutoff)
        if len(ids)<size:break
    return affected

async def standard_purge(con,table,where,cutoff,dry,size):
    sql=f'SELECT t.id FROM {table} t WHERE {where} LIMIT $2'
    return await batched(con,sql,(cutoff,),table,where,cutoff,dry,size)

async def stale_uploads(con,dry,now):
    if dry:return int(await con.fetchval("SELECT count(*)::int FROM upload_intents WHERE status IN ('pending','aborted') AND expires_at<$1",now) or 0),0
    rows=await con.fetch("SELECT * FROM upload_intents WHERE status IN ('pending','aborted') AND expires_at<$1 ORDER BY expires_at LIMIT 500",now)
    removed=0;objects=0
    for r in rows:
        changed=await con.fetchrow("UPDATE upload_intents SET status='aborted' WHERE id=$1 AND status IN ('pending','aborted') AND expires_at<$2 RETURNING id",r['id'],now)
        if not changed:continue
        try:await delete_object(r['object_key'])
        except Exception:continue
        objects+=1
        deleted=await con.fetchrow("DELETE FROM upload_intents WHERE id=$1 AND status='aborted' RETURNING id",r['id'])
        removed+=bool(deleted)
    return removed,objects

REFERENCES='''SELECT count(*)::int FROM (
 SELECT id FROM upload_intents WHERE object_key=$1 AND status='attached' AND
 (purpose<>'speaking_recording' OR speaking_attempt_id IS DISTINCT FROM $2::uuid OR greatest(created_at,finalized_at,used_at)>=$3)
 UNION ALL SELECT id FROM speaking_attempts WHERE recording_object_key=$1 AND id<>$2::uuid
 UNION ALL SELECT id FROM speaking_materials WHERE primary_object_key=$1
 UNION ALL SELECT id FROM material_blocks WHERE object_key=$1
 UNION ALL SELECT id FROM resource_blocks WHERE object_key=$1
) refs'''

async def recordings(con,dry,cutoff,size):
    sql='''SELECT s.id,s.recording_object_key FROM speaking_attempts s
      WHERE greatest(s.created_at,s.submitted_at)<$1 AND s.recording_object_key IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM upload_intents u WHERE u.speaking_attempt_id=s.id
      AND u.object_key=s.recording_object_key AND u.purpose='speaking_recording'
      AND greatest(u.created_at,u.finalized_at,u.used_at)>=$1) LIMIT $2'''
    rows=await con.fetch(sql+('' if dry else ' FOR UPDATE SKIP LOCKED'),cutoff,size)
    removed=0
    for r in rows if not dry else []:
        key=r['recording_object_key']
        if not key or await con.fetchval(REFERENCES,key,r['id'],cutoff):continue
        try:await delete_object(key)
        except Exception:continue
        removed+=1
        await con.execute('UPDATE speaking_attempts SET recording_object_key=NULL WHERE id=$1 AND recording_object_key=$2',r['id'],key)
        await con.execute("DELETE FROM upload_intents WHERE object_key=$1 AND purpose='speaking_recording' AND speaking_attempt_id=$2",key,r['id'])
    return len(rows),removed

def work_filter(table,column,protected):
    veto=(" AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.source_type IN ("+
       ','.join("'"+name+"'" for name in protected)+") AND e.source_id=t.id)") if protected else ''
    if table=='speaking_attempts':
        veto+=''' AND t.recording_object_key IS NULL AND NOT EXISTS(
          SELECT 1 FROM upload_intents u WHERE u.speaking_attempt_id=t.id AND u.purpose='speaking_recording'
          AND ((u.status IN ('finalized','attached') AND greatest(u.created_at,u.finalized_at,u.used_at)>=$1)
               OR (u.status='pending' AND u.expires_at>=$2)))'''
    return f'{column}<$1'+veto

async def old_work(con,dry,cutoff,now,size):
    totals={};total=0
    for table,column,protect,label in OLD_WORK:
        cond=work_filter(table,column,protect)
        select=f'SELECT t.id FROM {table} t WHERE {cond} LIMIT $3' if table=='speaking_attempts' else f'SELECT t.id FROM {table} t WHERE {cond} LIMIT $2'
        args=(cutoff,now,size) if table=='speaking_attempts' else (cutoff,size)
        count=0
        for _ in range(1000):
            rows=await con.fetch(select,*args)
            if not rows:break
            ids=[r['id'] for r in rows];count+=len(ids)
            if dry:break
            if table=='speaking_attempts':
                await con.execute(f'DELETE FROM {table} t WHERE t.id=ANY($3::uuid[]) AND ({cond})',cutoff,now,ids)
            else:
                await con.execute(f'DELETE FROM {table} t WHERE t.id=ANY($2::uuid[]) AND ({cond})',cutoff,ids)
            if len(ids)<size:break
        totals[label]=count;total+=count
    note=', '.join(f'{k}: {v}' for k,v in totals.items() if v>0) or 'nothing matched'
    return total,f'only work no evaluation refers to ({note}); answers cascade with their attempt'

async def run_policy(con,dry,actor,now=None):
    now=now or datetime.now(timezone.utc)
    cfg=config();size=cfg['batchSize'];results=[]
    def add(rule,n,applied=None,note=None):
        r={'rule':rule,'affected':int(n),'applied':not dry if applied is None else applied}
        if note is not None:r['note']=note
        results.append(r)
    locked=True
    if not dry:
        locked=bool(await con.fetchval('SELECT pg_try_advisory_xact_lock(hashtext($1))','learners_area.retention'))
        if not locked:
            return {'config':cfg,'dryRun':False,'locked':False,'results':[{'rule':'run','affected':0,'applied':False,'note':'another retention run holds the lock'}]}
    raw=months_ago(cfg['rawEventMonths'],now)
    structured=months_ago(cfg['structuredResultMonths'],now)
    add('learning_history',await standard_purge(con,'activity_events','t.created_at<$1',structured,dry,size))
    add('read_notifications',await standard_purge(con,'notifications','t.created_at<$1 AND t.read_at IS NOT NULL',raw,dry,size))
    removed,objects=await stale_uploads(con,dry,now)
    add('abandoned_uploads',removed,note='counted for the preview; the upload module performs the sweep' if dry else f'{objects} objects removed from object storage')
    add('structured_evaluations',await standard_purge(con,'evaluations','t.created_at<$1',structured,dry,size))
    count,rm=await recordings(con,dry,structured,size)
    add('speaking_recordings',count,note='audio objects that would be removed; the transcript and attempt record stay' if dry else f'{rm} audio objects removed; transcript and attempt record stay')
    n,note=await old_work(con,dry,structured,now,size)
    add('evaluated_work_past_window',n,note=note)
    audit_cutoff=months_ago(cfg['auditMonths'],now)
    add('audit_history',await standard_purge(con,'audit_log','t.created_at<$1',audit_cutoff,dry,size))
    add('generated_exports',0,False,'no export generation is enabled in this phase')
    app_cutoff=months_ago(cfg['inactiveStudentMonths'],now)
    candidates=await con.fetch('''SELECT id FROM access_requests WHERE decided_at IS NOT NULL
      AND decided_at<$1 AND (message IS NOT NULL OR decision_note IS NOT NULL) LIMIT $2''',app_cutoff,size)
    if not dry:
        for i in range(0,len(candidates),100):
            await con.execute('UPDATE access_requests SET message=NULL,decision_note=NULL WHERE id=ANY($1::uuid[])',[r['id'] for r in candidates[i:i+100]])
    add('applicant_free_text',len(candidates),note="clears the applicant's note and the decision note; the decision record (who, when, outcome) is kept")
    clauses=' OR '.join(f'EXISTS(SELECT 1 FROM {t} a WHERE a.user_id=u.id AND {ts}>=$1 AND ({condition}))' for t,ts,condition in ACTIVITY_SOURCES)
    inactive=f'''u.role='student' AND
      (u.last_meaningful_activity_at<$1 OR (u.last_meaningful_activity_at IS NULL AND u.created_at<$1))
      AND u.account_status IN ('active','pending','rejected') AND NOT ({clauses})'''
    rows=await con.fetch(f'SELECT u.id FROM users u WHERE {inactive} LIMIT $2',app_cutoff,size)
    anonymised=0
    if not dry:
        for i in range(0,len(rows),100):
            changed=await con.fetch(f'''UPDATE users u SET name='Former student',email=NULL,telegram_id=NULL,
              password_hash=NULL,account_status='suspended',status_reason='anonymised_by_retention',status_updated_at=$3
              WHERE u.id=ANY($2::uuid[]) AND {inactive} RETURNING u.id''',app_cutoff,[r['id'] for r in rows[i:i+100]],now)
            anonymised+=len(changed)
    add('inactive_student_accounts',len(rows) if dry else anonymised,
      note='measured on meaningful activity and persisted learner work, falling back to registration; personal fields are scrubbed, structured work stays until its own window closes')
    if not dry:
        await con.execute('''INSERT INTO audit_log(actor_user_id,action,metadata)
          VALUES($1,'retention.cleanup',$2::jsonb)''',actor,
          json.dumps({'rules':[{'rule':r['rule'],'affected':r['affected']} for r in results]}))
    return {'config':cfg,'dryRun':dry,'locked':locked,'results':results}

@router.post('/api/owner/retention')
async def retention_policy(req:Request):
    user=await core.current_user(req,active=True)
    if not user or user['role']!='owner':return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    dry=b.get('dryRun') if isinstance(b,dict) and isinstance(b.get('dryRun'),bool) else True
    db=await core.pool()
    async with db.acquire() as con:
        if dry:result=await run_policy(con,True,user['id'])
        else:
            async with con.transaction():result=await run_policy(con,False,user['id'])
    return core.j({'ok':True,'dryRun':result['dryRun'],'config':result['config'],'results':result['results']})

def install():core.app.include_router(router)
