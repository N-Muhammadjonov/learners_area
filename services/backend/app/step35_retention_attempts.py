"""Retention start + submit service: deterministic v5 scoring and PostgreSQL locks.
Mirrors retention-attempts.ts: same row locks, rotation cycles, immutable version,
SAVEPOINT for evaluation failure and persisted-draft timeout behavior.
"""
from __future__ import annotations
import json,secrets
from datetime import datetime,timezone,timedelta
from fastapi import APIRouter,Request
from . import main as core
from .step20_retention_transitions_port import learner_payload,phase,problem
from .step35_retention_scoring import evaluate_recall,StructureError,VERSION
router=APIRouter()
LEVELS={'A2','B1','B2','C1','C2'}
class RetentionFault(Exception):
    def __init__(self,code):self.code=code

def now():return datetime.now(timezone.utc)

def utf16len(s):return len(s.encode('utf-16-le'))//2

async def finalize(con,row,when,status):
    if row['status'] in ('completed','timed_out'):return row
    if not row['retention_text_version_id']:raise RetentionFault('retention_scoring_failed')
    version=await con.fetchrow('SELECT scoring_structure FROM retention_text_versions WHERE id=$1',row['retention_text_version_id'])
    if not version:raise RetentionFault('retention_scoring_failed')
    try:
        struct=version['scoring_structure']
        if isinstance(struct,str):struct=json.loads(struct)
        score,breakdown=evaluate_recall(row['recall_text'] or '',struct)
    except (StructureError,TypeError,KeyError,ValueError):raise RetentionFault('retention_scoring_failed')
    updated=await con.fetchrow('''UPDATE retention_attempts SET status=$2,score=$3,score_breakdown=$4::jsonb,evaluator_version=$5,
       submitted_at=COALESCE(submitted_at,$6),completed_at=$6,updated_at=$6
       WHERE id=$1 AND status IN ('reading','recall') RETURNING *''',row['id'],status,score,json.dumps(breakdown,ensure_ascii=False),VERSION,when)
    if not updated:
        result=await con.fetchrow('SELECT * FROM retention_attempts WHERE id=$1',row['id'])
        if not result:raise RetentionFault('retention_attempt_not_found')
        return result
    if not updated['retention_text_id']:raise RetentionFault('retention_scoring_failed')
    await con.execute('''INSERT INTO retention_rotation_completions(user_id,level,cycle_number,retention_text_id,completed_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING''',updated['user_id'],updated['level'],updated['rotation_cycle'],updated['retention_text_id'],when)
    await con.execute('''UPDATE retention_rotation_state SET last_completed_text_id=$3,updated_at=$4 WHERE user_id=$1 AND level=$2''',
         updated['user_id'],updated['level'],updated['retention_text_id'],when)
    return updated

async def locked_rotation(con,user,level):
    state=await con.fetchrow('SELECT cycle_number,last_completed_text_id FROM retention_rotation_state WHERE user_id=$1 AND level=$2',user,level)
    cycle=state['cycle_number'] if state else 1
    completed=await con.fetch('''SELECT retention_text_id FROM retention_rotation_completions WHERE user_id=$1 AND level=$2 AND cycle_number=$3''',user,level,cycle)
    return cycle,{r['retention_text_id'] for r in completed},state['last_completed_text_id'] if state else None

async def choose(con,level,cycle,done,last):
    for _ in range(3):
        candidates=await con.fetch('''SELECT id,current_version_id FROM retention_texts WHERE level=$1 AND active=true
          AND current_version_id IS NOT NULL ORDER BY sequence ASC''',level)
        if not candidates:return None
        unseen=[c for c in candidates if c['id'] not in done]
        new_cycle=not unseen
        allowed=unseen or [c for c in candidates if not (len(candidates)>1 and last and c['id']==last)]
        if not allowed:allowed=candidates
        chosen=allowed[secrets.randbelow(len(allowed))]
        locked=await con.fetchrow('SELECT active,current_version_id,internal_label FROM retention_texts WHERE id=$1 FOR SHARE',chosen['id'])
        if locked and locked['active'] and locked['current_version_id']==chosen['current_version_id']:
            return chosen['id'],chosen['current_version_id'],cycle+int(new_cycle),locked['internal_label']
    return None

@router.post('/api/retention/attempts')
async def start(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    body=await core.payload(req)
    level=body.get('level') if isinstance(body,dict) else None
    if level not in LEVELS:return problem('retention_invalid_level')
    db=await core.pool()
    try:
        async with db.acquire() as con:
            async with con.transaction():
                await con.execute('SELECT pg_advisory_xact_lock(hashtext($1))','retention.start:'+str(user['id'])+':'+level)
                live=await con.fetchrow('''SELECT * FROM retention_attempts WHERE user_id=$1 AND level=$2
                   AND status IN ('reading','recall') FOR UPDATE LIMIT 1''',user['id'],level)
                timestamp=now()
                if live:
                    if phase(live,timestamp)=='timed_out':
                        live=await finalize(con,live,timestamp,'timed_out');outcome='finalized'
                    else:outcome='resumed'
                else:
                    cycle,done,last=await locked_rotation(con,user['id'],level)
                    selected=await choose(con,level,cycle,done,last)
                    if not selected:raise RetentionFault('retention_no_content')
                    text,version,cycle,label=selected
                    start_at=timestamp;read_end=start_at+timedelta(seconds=120);write_end=read_end+timedelta(seconds=180)
                    live=await con.fetchrow('''INSERT INTO retention_attempts(user_id,retention_text_id,retention_text_version_id,
                      retention_label_snapshot,level,rotation_cycle,status,read_started_at,read_ends_at,write_started_at,write_ends_at,recall_text)
                      VALUES($1,$2,$3,$4,$5,$6,'reading',$7,$8,$8,$9,'') RETURNING *''',
                      user['id'],text,version,label,level,cycle,start_at,read_end,write_end)
                    await con.execute('''INSERT INTO retention_rotation_state(user_id,level,cycle_number,updated_at) VALUES($1,$2,$3,$4)
                      ON CONFLICT (user_id,level) DO UPDATE SET cycle_number=GREATEST(retention_rotation_state.cycle_number,excluded.cycle_number),
                      updated_at=excluded.updated_at''',user['id'],level,cycle,now())
                    outcome='created'
                payload=await learner_payload(con,live,now())
                if payload is None:raise RetentionFault('retention_attempt_not_found')
        return core.j({'outcome':outcome,**payload})
    except RetentionFault as e:return problem(e.code)
    except Exception:return core.j({'error':'retention_unavailable'},500)

@router.post('/api/retention/attempts/{id}/abandon')
async def abandon(req:Request,id:str):
    """Discard an unfinished attempt on navigation without scoring or recording history."""
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    attempt_id=core.uuid_value(id)
    if not attempt_id:return problem('retention_attempt_not_found')
    try:
        db=await core.pool()
        async with db.acquire() as con:
            # A submitted or already timed-out attempt is immutable here.
            await con.execute("""DELETE FROM retention_attempts
                WHERE id=$1 AND user_id=$2 AND status IN ('reading','recall')""",
                attempt_id,user['id'])
        return core.j({'ok':True},headers={'Cache-Control':'private, no-store'})
    except Exception:
        return core.j({'error':'retention_unavailable'},500)


@router.post('/api/retention/attempts/{id}/submit')
async def submit(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    body=await core.payload(req)
    recall=body.get('recallText') if isinstance(body,dict) else None
    if recall is not None and (not isinstance(recall,str) or utf16len(recall)>6000):return problem('retention_invalid_input')
    identifier=core.uuid_value(id)
    if not identifier:return problem('retention_attempt_not_found')
    db=await core.pool();scoring_failed=False;result=None
    try:
        async with db.acquire() as con:
            async with con.transaction():
                row=await con.fetchrow('SELECT * FROM retention_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',identifier,user['id'])
                if not row:raise RetentionFault('retention_attempt_not_found')
                timestamp=now()
                if row['status'] in ('completed','timed_out'):idempotent=True
                else:
                    idempotent=False;current=phase(row,timestamp)
                    if current=='reading':raise RetentionFault('retention_wrong_phase')
                    if current=='timed_out':row=await finalize(con,row,timestamp,'timed_out')
                    else:
                        submitted=recall if recall is not None else row['recall_text']
                        if submitted!=row['recall_text']:
                            row=await con.fetchrow('UPDATE retention_attempts SET recall_text=$2,updated_at=$3 WHERE id=$1 RETURNING *',row['id'],submitted,timestamp)
                        try:
                            async with con.transaction():row=await finalize(con,row,timestamp,'completed')
                        except RetentionFault as e:
                            if e.code=='retention_scoring_failed':scoring_failed=True
                            else:raise
                if not scoring_failed:
                    result=await learner_payload(con,row,now())
                    if result is None:raise RetentionFault('retention_attempt_not_found')
        if scoring_failed:return problem('retention_scoring_failed')
        return core.j({'idempotent':idempotent,**result})
    except RetentionFault as e:return problem(e.code)
    except Exception:return core.j({'error':'retention_unavailable'},500)

def install():core.app.include_router(router)
