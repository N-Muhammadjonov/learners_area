"""Learner's own Retention attempts: visibility/read phase projections.
The terminal evaluator must run before returning an expired live attempt.
"""
from __future__ import annotations
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .step20_retention_transitions_port import learner_payload,phase
router=APIRouter()

async def projection(con,row):
    now=datetime.now(timezone.utc)
    if phase(row,now)=='timed_out' and row['status'] not in ('timed_out','completed'):
        # Never return a guessed score; this case requires the evaluator and
        # persisted terminal breakdown from the exact original scoring engine.
        return None
    return await learner_payload(con,row,now)

@router.get('/api/retention/attempts/{id}')
async def retention_attempt_detail(req:Request,id:str):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if not core.uuid_value(id):return core.j({'error':'retention_attempt_not_found'},404)
    db=await core.pool()
    async with db.acquire() as con:
        row=await con.fetchrow('SELECT * FROM retention_attempts WHERE id=$1 AND user_id=$2',core.uuid_value(id),u['id'])
        if not row:return core.j({'error':'retention_attempt_not_found'},404)
        value=await projection(con,row)
        if value is None:return core.j({'error':'retention_unavailable'},500)
    return core.j(value)

@router.get('/api/retention/attempts')
async def retention_live(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        row=await con.fetchrow("""SELECT * FROM retention_attempts
          WHERE user_id=$1 AND status IN ('reading','recall') ORDER BY created_at DESC LIMIT 1""",u['id'])
        if not row:return core.j({'active':None})
        value=await projection(con,row)
        if value is None:return core.j({'error':'retention_unavailable'},500)
    return core.j({'active':value})

def install():core.app.include_router(router)
