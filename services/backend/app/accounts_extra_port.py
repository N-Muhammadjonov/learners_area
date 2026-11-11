"""User-role, account status and onboarding operations from the source backend."""
from __future__ import annotations
import re
import math
from datetime import datetime,timezone
from fastapi import APIRouter, Request
from . import main as core
from .lesson_writing_port import js_length, is_js_uuid
from .security import issue_token, SESSION_COOKIE,SESSION_TTL,clear_session_cookie,write_cookie
from .center_admin_port import administrator
from . import main as main
import json

router=APIRouter()
RANK={'student':0,'teacher':1,'admin':2,'owner':3}

def role_check(actor,target):return RANK.get(actor,-1)>RANK.get(target,-1)

@router.patch('/api/admin/users/{id}/role')
async def change_role(req:Request,id:str):
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    actor=await core.current_user(req,active=True)
    if not administrator(actor):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    next_role=b.get('role') if isinstance(b,dict) else None
    if next_role not in RANK:return core.j({'error':'invalid_input'},400)
    if next_role=='owner':return core.j({'error':'owner_requires_transfer'},409)
    if actor['role']=='admin' and next_role not in ('student','teacher'):return core.j({'error':'forbidden'},403)
    if str(actor['id']).lower()==id.lower():return core.j({'error':'cannot_change_own_role'},409)
    db=await core.pool()
    async with db.acquire() as conn:
        row=await conn.fetchrow('SELECT role FROM users WHERE id=$1 LIMIT 1',id)
        if not row:return core.j({'error':'not_found'},404)
        if row['role']=='owner' or not role_check(actor['role'],row['role']):return core.j({'error':'outranked'},403)
        await conn.execute('UPDATE users SET role=$2 WHERE id=$1',id,next_role)
        await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
            VALUES($1,'role.changed','user',$2,$3::jsonb)''',actor['id'],id,json.dumps({'from':row['role'],'to':next_role}))
        await conn.execute('''INSERT INTO notifications(user_id,type,title,href)
            VALUES($1,'ROLE_CHANGED',$2,'/app')''',id,'Your role is now '+next_role)
    return core.j({'ok':True,'role':next_role})

@router.post('/api/admin/users/{id}/status')
async def change_account_status(req:Request,id:str):
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    actor=await core.current_user(req,active=True)
    if not administrator(actor):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    status=b.get('status') if isinstance(b,dict) else None
    reason=b.get('reason') if isinstance(b,dict) else None
    if status not in ('pending','active','rejected','suspended') or (reason is not None and (not isinstance(reason,str) or js_length(reason.strip())>500)):
        return core.j({'error':'invalid_input'},400)
    if str(actor['id']).lower()==id.lower():return core.j({'error':'cannot_change_own_status'},409)
    db=await core.pool()
    async with db.acquire() as conn:
        row=await conn.fetchrow('SELECT role FROM users WHERE id=$1 LIMIT 1',id)
        if not row:return core.j({'error':'not_found'},404)
        if row['role']=='owner' or not role_check(actor['role'],row['role']):return core.j({'error':'outranked'},403)
        await conn.execute('''UPDATE users SET account_status=$2,status_updated_at=NOW(),status_reason=$3 WHERE id=$1''',id,status,actor and reason.strip() if reason else None)
        await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
             VALUES($1,$2,'user',$3,$4::jsonb)''',actor['id'],'account.suspended' if status=='suspended' else 'account.reactivated',id,json.dumps({'status':status}))
        await conn.execute('''INSERT INTO notifications(user_id,type,title,body,href)
            VALUES($1,$2,$3,$4,$5)''',id,'ACCOUNT_SUSPENDED' if status=='suspended' else 'ACCOUNT_UPDATED',
            'Account suspended' if status=='suspended' else 'Account '+status,reason.strip() if reason else None,
            '/app' if status=='active' else '/pending')
    return core.j({'ok':True,'status':status})


@router.delete('/api/admin/users/{id}')
async def delete_suspended_student(req:Request,id:str):
    """Permanently erase a suspended student and their cascade-owned records."""
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    actor=await core.current_user(req,active=True)
    if not actor or actor['role']!='owner':return core.j({'error':'forbidden'},403)
    if str(actor['id']).lower()==id.lower():return core.j({'error':'cannot_delete_self'},409)
    db=await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            target=await conn.fetchrow('SELECT id,role,account_status FROM users WHERE id=$1 FOR UPDATE',id)
            if not target:return core.j({'error':'not_found'},404)
            if target['role']!='student' or target['account_status']!='suspended':
                return core.j({'error':'account_not_deletable'},409)
            await conn.execute('DELETE FROM users WHERE id=$1',id)
            await conn.execute("""INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
              VALUES($1,'account.deleted','user',$2,$3::jsonb)""",
              actor['id'],id,json.dumps({'previousStatus':'suspended','role':'student'}))
    return core.j({'ok':True,'deleted':True},headers={'Cache-Control':'private, no-store'})


async def purge_rejected_accounts():
    """Delete rejected student accounts at or after seven full days, in bounded batches."""
    db=await core.pool()
    removed=0
    for _ in range(5):
        async with db.acquire() as conn:
            async with conn.transaction():
                deleted=await conn.fetch("""
                    WITH expired AS (
                      SELECT id FROM users
                      WHERE role='student' AND account_status='rejected'
                        AND status_updated_at <= NOW()-INTERVAL '7 days'
                      ORDER BY status_updated_at,id LIMIT 100 FOR UPDATE SKIP LOCKED
                    ), removed AS (
                      DELETE FROM users u USING expired e WHERE u.id=e.id RETURNING u.id
                    )
                    INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
                    SELECT NULL,'account.rejected.expired','user',id::text,
                           '{"policy":"rejected_after_7_days"}'::jsonb FROM removed
                    RETURNING target_id
                """)
        removed+=len(deleted)
        if len(deleted)<100:break
    return removed


def coerce_number(x):
    if x is None:return 0.0
    if isinstance(x,(dict,list)):
        if x==[]:return 0.0
        return float('nan')
    if isinstance(x,str) and not x.strip():return 0.0
    try:return float(x)
    except (TypeError,ValueError,OverflowError):return float('nan')

@router.post('/api/onboarding')
async def onboarding(req:Request):
    authority=await core.current_authority(req)
    u=authority['user'] if authority else None
    if not u or u['account_status']!='active':return core.auth_error()
    b=await core.payload(req)
    if not isinstance(b,dict):return core.j({'error':'Invalid input'},400)
    if set(b)-{'preferredLanguage','currentLevel','currentBand','targetBand','examDate','dailyStudyMinutes','strongestSkill','weakestSkill'}:return core.j({'error':'Unrecognized key(s) in object'},400)
    language=b.get('preferredLanguage');level=b.get('currentLevel');exam=b.get('examDate')
    strongest=b.get('strongestSkill');weakest=b.get('weakestSkill')
    if language not in ('uz','en'):return core.j({'error':'Invalid enum value'},400)
    if not isinstance(level,str) or not 1<=js_length(level)<=40:return core.j({'error':'String must contain at least 1 character(s)'},400)
    band=coerce_number(b['currentBand']) if 'currentBand' in b else None
    target=coerce_number(b.get('targetBand'))
    daily=coerce_number(b.get('dailyStudyMinutes'))
    if (band is not None and (not math.isfinite(band) or not 0<=band<=9 or (band*2)%1!=0)) or not math.isfinite(target) or not 0<=target<=9 or (target*2)%1!=0:return core.j({'error':'Number must be a multiple of 0.5'},400)
    if not math.isfinite(daily) or not daily.is_integer() or not 5<=daily<=600:return core.j({'error':'Expected number'},400)
    if exam is not None:
        if not isinstance(exam,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',exam):return core.j({'error':'Invalid'},400)
        try:datetime.strptime(exam,'%Y-%m-%d')
        except ValueError:return core.j({'error':'Invalid calendar date'},400)
    if strongest not in ('listening','reading','writing','speaking') or weakest not in ('listening','reading','writing','speaking'):
        return core.j({'error':'Invalid enum value'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        await conn.execute('''INSERT INTO onboarding_profiles(user_id,current_level,current_band,target_band,exam_date,
            daily_study_minutes,strongest_skill,weakest_skill) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT(user_id) DO UPDATE SET current_level=excluded.current_level,current_band=excluded.current_band,
            target_band=excluded.target_band,exam_date=excluded.exam_date,daily_study_minutes=excluded.daily_study_minutes,
            strongest_skill=excluded.strongest_skill,weakest_skill=excluded.weakest_skill''',
            u['id'],level,band,target,datetime.strptime(exam,'%Y-%m-%d').date() if exam else None,int(daily),strongest,weakest)
        await conn.execute('UPDATE users SET onboarding_completed_at=NOW(),locale=$2 WHERE id=$1',u['id'],language)
        course=await conn.fetchrow("SELECT id FROM courses WHERE slug='ielts' LIMIT 1")
        if course:
            exists=await conn.fetchval('SELECT id FROM enrollments WHERE user_id=$1 LIMIT 1',u['id'])
            if not exists:await conn.execute('INSERT INTO enrollments(user_id,course_id) VALUES($1,$2)',u['id'],course['id'])
    token=issue_token({'id':u['id'],'auth_version':authority['authVersion'],'role':u['role'],
                       'name':u['name'],'locale':language,'onboarding_completed_at':datetime.now(timezone.utc)})
    response=core.j({'ok':True})
    clear_session_cookie(response,req)
    write_cookie(response,req,SESSION_COOKIE,token,SESSION_TTL,http_only=True)
    write_cookie(response,req,'la_locale',language,365*86400)
    return response


def install():core.app.include_router(router)
