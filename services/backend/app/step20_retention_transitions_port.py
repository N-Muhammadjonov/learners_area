"""Retention recall autosave and early-reading transition.

The client cannot supply a clock, owner or alternate text ID. This module always
locks the owner-scoped row before changing the server-managed deadline.
"""
from __future__ import annotations
from datetime import datetime,timezone,timedelta
import regex,unicodedata
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
router=APIRouter()
STATUS={'retention_no_content':404,'retention_invalid_level':400,'retention_invalid_structure':422,'retention_scoring_failed':500,'retention_attempt_not_found':404,'retention_expired':410,'retention_wrong_phase':409,
        'retention_invalid_input':400,'retention_unavailable':500}

def problem(code):return core.j({'error':code},STATUS.get(code,500))
def phase(row,now):
    if row['status'] in ('completed','timed_out'):return row['status']
    if now<row['read_ends_at']:return 'reading'
    if now<row['write_ends_at']:return 'recall'
    return 'timed_out'

def iso(t):return t.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z') if t else None

def word_count(value):
    value=regex.sub(r'(?<=\d)[,\u00a0\u202f\u2009](?=\d)','',value)
    value=unicodedata.normalize('NFKC',value)
    return len(regex.findall(r"[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*",value))

async def learner_payload(con,record,now):
    state=phase(record,now)
    label=record['retention_label_snapshot']
    if label is None and record['retention_text_id']:
        label=await con.fetchval('SELECT internal_label FROM retention_texts WHERE id=$1',record['retention_text_id'])
    obj={'attemptId':str(record['id']),'level':record['level'],'label':label or '',
         'readStartedAt':iso(record['read_started_at']),'readEndsAt':iso(record['read_ends_at']),
         'writeStartedAt':iso(record['write_started_at']),'writeEndsAt':iso(record['write_ends_at']),
         'phase':state,'serverNow':iso(now)}
    if state=='reading':
        if not record['retention_text_version_id']:return None
        source=await con.fetchrow('SELECT body_text,word_count FROM retention_text_versions WHERE id=$1',record['retention_text_version_id'])
        if not source:return None
        spans=await con.fetch('''SELECT id,start_char AS "startChar",end_char AS "endChar",surface_form AS "surfaceForm"
          FROM lexical_occurrences WHERE source_type='retention' AND retention_text_version_id=$1''',record['retention_text_version_id'])
        obj.update(wordCount=source['word_count'],bodyText=source['body_text'],occurrences=[row_to_dict(r) for r in spans])
    elif state=='recall':obj['recallDraft']=record['recall_text'] or ''
    else:
        score=record['score'] or 0
        breakdown=record['score_breakdown'] or {'schemaVersion':1,'evaluatorVersion':'','maxScore':100,'score':score,
            'totals':{'captured':0,'partial':0,'missed':0,'contradicted':0,'matchedGroups':0,'totalGroups':0,
                      'mainIdeasRemembered':0,'mainIdeasPossible':0},'claims':[]}
        obj.update(score=score,breakdown=breakdown,evaluatorVersion=record['evaluator_version'] or '',
                   recallWordCount=word_count(record['recall_text'] or ''),submittedAt=iso(record['submitted_at']),completedAt=iso(record['completed_at']))
    return obj

@router.patch('/api/retention/attempts/{id}/draft')
async def draft(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    body=await core.payload(req)
    value=body.get('recallText','') if isinstance(body,dict) else ''
    if not isinstance(value,str) or len(value.encode('utf-16-le'))//2>6000:return problem('retention_invalid_input')
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            row=await con.fetchrow('SELECT * FROM retention_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',core.uuid_value(id),user['id']) if core.uuid_value(id) else None
            if not row:return problem('retention_attempt_not_found')
            if row['status'] in ('completed','timed_out'):return problem('retention_expired')
            now=datetime.now(timezone.utc)
            if phase(row,now)!='recall':return problem('retention_wrong_phase')
            await con.execute('UPDATE retention_attempts SET recall_text=$2,updated_at=$3 WHERE id=$1',row['id'],value,now)
    return core.j({'ok':True,'savedAt':iso(now),'characterCount':len(value.encode('utf-16-le'))//2})

@router.post('/api/retention/attempts/{id}/finish-reading')
async def finish_reading(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            row=await con.fetchrow('SELECT * FROM retention_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',core.uuid_value(id),user['id']) if core.uuid_value(id) else None
            if not row:return problem('retention_attempt_not_found')
            if row['status'] in ('completed','timed_out'):return problem('retention_expired')
            now=datetime.now(timezone.utc)
            state=phase(row,now)
            idempotent=True
            if state=='reading':
                next_at=now+timedelta(seconds=180)
                updated=await con.fetchrow('''UPDATE retention_attempts SET read_ends_at=$2,write_started_at=$2,
                   write_ends_at=$3,updated_at=$2 WHERE id=$1 RETURNING *''',row['id'],now,next_at)
                row=updated
                idempotent=False
            elif state=='timed_out':
                # The TypeScript evaluator must be present to finalize with the
                # persisted scoring breakdown. Never claim success without it.
                return core.j({'error':'retention_unavailable'},500)
            obj=await learner_payload(con,row,now)
            if obj is None:return problem('retention_attempt_not_found')
    return core.j({'idempotent':idempotent,**obj})

def install():core.app.include_router(router)
