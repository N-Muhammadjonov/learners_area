"""Narrow Telegram admin/people endpoints ported from original services."""
from __future__ import annotations
import asyncio
import math
import os
import re
import time
from fastapi import APIRouter, Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_admins_port import actor_for,denied_response
from .rate_limit import async_counter as counter,too_many,RULES

router=APIRouter()
_CHECKED={}

@router.get('/api/internal/telegram/admission/pending')
async def telegram_pending_admissions(req:Request):
    error=verify_bot(req)
    if error is not None:return error
    db=await core.pool()
    async with db.acquire() as conn:
        actor,reason=await actor_for(conn,req.query_params.get('actorTelegramId'),'ADMISSIONS')
        if reason:return denied_response(reason)
        try:
            rows=await conn.fetch('''SELECT COALESCE(r.id,u.id) AS id,u.id AS "userId",
             u.name AS "applicantName",u.email AS "applicantEmail",u.role AS "applicantRole",
             u.account_status AS "applicantStatus",r.message,
             COALESCE(r.created_at,u.created_at,NOW()) AS "createdAt"
             FROM users u LEFT JOIN access_requests r ON r.user_id=u.id AND r.status='pending'
             WHERE u.account_status='pending' AND r.decided_at IS NULL ORDER BY u.created_at''')
            raw=req.query_params.get('page','1')
            try: num=float(raw)
            except ValueError:num=1.0
            if not math.isfinite(num): num=1.0
            # Source Math.max(1,Number(... )||1) and Array.slice truncate fractional indexes.
            page=max(1,num if num else 1)
            start=max(0,int((page-1)*8));stop=max(0,int(page*8))
            def out(r):
                dt=r['createdAt']
                return {'id':str(r['id']),'userId':str(r['userId']),'applicantName':r['applicantName'],
                    'applicantEmail':r['applicantEmail'],'applicantRole':r['applicantRole'],
                    'applicantStatus':r['applicantStatus'],'message':r['message'],
                    'createdAt':dt.isoformat(timespec='milliseconds').replace('+00:00','Z') if hasattr(dt,'isoformat') else dt}
            return core.j({'page':page,'pageSize':8,'total':len(rows),'requests':[out(r) for r in rows[start:stop]]})
        except Exception:return core.j({'error':'internal_error'},500)

@router.post('/api/admin/people/refresh-telegram')
async def refresh_people(req:Request):
    user=await core.current_user(req,active=True)
    if not user or user['role'] not in ('owner','admin'):return core.j({'error':'forbidden'},403)
    RULES.setdefault('people_contacts_refresh',(12,60))
    delay=await counter('people_contacts_refresh',str(user['id']),consume=True)
    if delay:return too_many(delay)
    b=await core.payload(req)
    ids=b.get('ids') if isinstance(b,dict) else None
    if not isinstance(ids,list) or len(ids)>25 or not all(isinstance(i,str) and core.uuid_value(i) for i in ids):return core.j({'error':'invalid_input'},400)
    token=os.getenv('TELEGRAM_BOT_TOKEN')
    if not token or not re.fullmatch(r'\d+:[\w-]{20,}',token):return core.j({'configured':False,'changed':False},headers={'Cache-Control':'private, no-store'})
    db=await core.pool()
    async with db.acquire() as conn:
        rows=await conn.fetch('''SELECT u.telegram_id AS "telegramId",tc.username
          FROM users u JOIN telegram_contacts tc ON tc.telegram_user_id=u.telegram_id WHERE u.id=ANY($1::uuid[])''',ids)
    now=time.time();changed=False
    import httpx
    async with httpx.AsyncClient(timeout=2) as client:
        for offset in range(0,len(rows),5):
            async def check(row):
                nonlocal changed
                tid=row['telegramId']
                if not tid or now-_CHECKED.get(tid,0)<60:return
                if len(_CHECKED)>=1000:
                    for k,v in list(_CHECKED.items()):
                        if now-v>60: _CHECKED.pop(k,None)
                if len(_CHECKED)>=1000:_CHECKED.pop(next(iter(_CHECKED)))
                _CHECKED[tid]=now
                try:
                    response=await client.post('https://api.telegram.org/bot'+token+'/getChat',json={'chat_id':tid})
                    if response.status_code>=400:return
                    result=response.json()
                    v=result.get('result') if isinstance(result,dict) else None
                    if not result.get('ok') or not isinstance(v,dict) or str(v.get('id'))!=tid or v.get('type')!='private':return
                    username=v.get('username')[:120] if isinstance(v.get('username'),str) else None
                    if username!=row['username']:
                        db=await core.pool()
                        async with db.acquire() as conn:
                            await conn.execute('''UPDATE telegram_contacts SET username=$2,updated_at=to_timestamp($3)
                             WHERE telegram_user_id=$1 AND username IS NOT DISTINCT FROM $4''',tid,username,now,row['username'])
                        changed=True
                except (Exception):return
            await asyncio.gather(*(check(r) for r in rows[offset:offset+5]))
    return core.j({'configured':True,'changed':changed},headers={'Cache-Control':'private, no-store'})


def install():core.app.include_router(router)
