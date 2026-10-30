"""Telegram bot admission bridge: bearer auth, permissions, gates and owner-safe decision.

Derived from lib/telegram/admission-bridge.ts and data/admission.ts.
"""
from __future__ import annotations
import re,os,json
from fastapi import APIRouter,Request
from . import main as core
from .db import PooledReads
from .internal_bot_ready_port import verify_bot
from .telegram_admins_port import actor_for,denied_response
from .telegram_preferences_port import valid_actor
from .telegram_settings_port import list_channels
from .rate_limit import RULES,async_counter as counter,too_many
router=APIRouter()


def clip(v,n):return v.strip()[:n] if isinstance(v,str) and v.strip() else None

async def gates(conn,tg):
    if not re.fullmatch(r'(?i)(?:1|true)',os.getenv('TELEGRAM_ACCESS_GATES_ENABLED','true').strip()):return None
    contact=await conn.fetchrow('SELECT phone_number,phone_verified_at FROM telegram_contacts WHERE telegram_user_id=$1',tg)
    if not contact or not contact['phone_number'] or not contact['phone_verified_at']:
        return {'error':'phone_required'}
    channels=await list_channels(conn)
    if not channels:return None
    token=os.getenv('TELEGRAM_BOT_TOKEN')
    if not token:return {'error':'membership_unavailable','requiredChannels':channels}
    import httpx
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            for ch in channels:
                resp=await client.get(f'https://api.telegram.org/bot{token}/getChatMember',params={'chat_id':ch['id'],'user_id':tg})
                data=resp.json()
                if not resp.is_success or not data.get('ok') or not data.get('result'):
                    raise ValueError('membership_unavailable')
                member=data['result'];status=member.get('status')
                if not (status in ('creator','administrator','member') or (status=='restricted' and member.get('is_member') is True)):
                    return {'error':'not_subscribed','requiredChannels':channels}
    except Exception:return {'error':'membership_unavailable','requiredChannels':channels}
    return None

@router.post('/api/internal/telegram/admission/request')
async def bot_admission_request(req:Request):
    err=verify_bot(req)
    if err is not None:return err
    b=await core.payload(req);b=b if isinstance(b,dict) else {}
    tg=b.get('telegramUserId') if isinstance(b.get('telegramUserId'),str) else ''
    RULES.setdefault('admission_request',(10,900))
    delay=await counter('admission_request','tg:'+ (tg or 'unknown'),consume=True)
    if delay:return too_many(delay)
    if not valid_actor(tg):return core.j({'error':'invalid_actor'},400)
    db=await core.pool()
    gated=await gates(PooledReads(db),tg)
    if gated:
        code=gated['error'];return core.j(gated,403 if code in ('phone_required','not_subscribed') else 503)
    async with db.acquire() as conn:
        name=clip(b.get('name'),200)
        if not name or len(name)<3 or not re.fullmatch(r'\S+(?:\s+\S+)+',name):return core.j({'error':'invalid_input'},400)
        username=clip(b.get('username'),120)
        username=username.lstrip('@') if username else None
        chat=clip(b.get('chatId'),64) or tg
        await conn.execute('''INSERT INTO telegram_contacts(telegram_user_id,chat_id,username,language_code,last_seen_at,updated_at)
             VALUES($1,$2,$3,$4,NOW(),NOW()) ON CONFLICT(telegram_user_id) DO UPDATE SET
             chat_id=EXCLUDED.chat_id,username=EXCLUDED.username,language_code=EXCLUDED.language_code,
             last_seen_at=NOW(),updated_at=NOW(),removed_at=NULL,bot_blocked_at=NULL''',tg,chat,username,clip(b.get('languageCode'),10))
        user=await conn.fetchrow('SELECT id,account_status FROM users WHERE telegram_id=$1',tg)
        if not user:
            try:
                user=await conn.fetchrow('''INSERT INTO users(telegram_id,name,role,account_status,locale)
                    VALUES($1,$2,'student','pending',$3) RETURNING id,account_status''',tg,name,'en' if b.get('languageCode')=='en' else 'uz')
            except Exception:
                user=await conn.fetchrow('SELECT id,account_status FROM users WHERE telegram_id=$1',tg)
        if not user:return core.j({'error':'internal_error'},500)
        if user['account_status'] in ('active','suspended'):
            return core.j({'success':True,'status':'already_active' if user['account_status']=='active' else 'suspended',
                           'userId':str(user['id']),'requestId':None})
        if user['account_status'] not in ('pending','rejected'):return core.j({'error':'not_requestable'},409)
        opened=await conn.fetchval('''SELECT id FROM access_requests WHERE user_id=$1 AND status='pending'
           ORDER BY created_at DESC LIMIT 1''',user['id'])
        if opened:return core.j({'success':True,'status':'already_pending','userId':str(user['id']),'requestId':str(opened)})
        request=await conn.fetchval('''INSERT INTO access_requests(user_id,message,status)
           VALUES($1,$2,'pending') RETURNING id''',user['id'],clip(b.get('message'),500))
        await conn.execute("UPDATE users SET account_status='pending',status_updated_at=NOW(),status_reason=NULL WHERE id=$1",user['id'])
        await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id)
          VALUES($1,'access.requested','access_request',$2)''',user['id'],str(request))
        await conn.execute('''INSERT INTO notifications(user_id,type,title,body,href,payload)
          SELECT id,'ACCESS_REQUESTED','New access request','An applicant is waiting for approval.',
          '/app/admin/admissions',jsonb_build_object('requestId',$1::text)
          FROM users WHERE role IN ('admin','owner') AND account_status='active' ''',str(request))
        return core.j({'success':True,'status':'reopened' if user['account_status']=='rejected' else 'pending',
                       'userId':str(user['id']),'requestId':str(request)})

@router.post('/api/internal/telegram/admission/decide')
async def bot_admission_decide(req:Request):
    err=verify_bot(req)
    if err is not None:return err
    b=await core.payload(req);b=b if isinstance(b,dict) else {}
    decision=b.get('decision');rid=b.get('requestId')
    if decision not in ('approve','reject') or not core.uuid_value(rid):return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,b.get('actorTelegramId'),'ADMISSIONS',audit_required=True)
        if error:return denied_response(error)
        request=await conn.fetchrow('SELECT id,user_id,status FROM access_requests WHERE id=$1',rid)
        target=request['user_id'] if request else rid
        if actor['linkedUserId'] and str(actor['linkedUserId'])==str(target):return core.j({'error':'self_approval'},403)
        applicant=await conn.fetchrow('SELECT telegram_id FROM users WHERE id=$1',target) if core.uuid_value(target) else None
        if applicant and applicant['telegram_id']==actor['telegramUserId']:return core.j({'error':'self_approval'},403)
        if not request:
            request=await conn.fetchrow('''SELECT id,user_id,status FROM access_requests
              WHERE user_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1''',rid)
        if not request:return core.j({'error':'not_found'},404)
        status='approved' if decision=='approve' else 'rejected'
        async with conn.transaction():
            claimed=await conn.fetchval('''UPDATE access_requests SET status=$2,decided_by_user_id=$3,
              decided_at=NOW(),decision_note=$4 WHERE id=$1 AND status='pending' RETURNING id''',
              request['id'],status,actor['auditUserId'],clip(b.get('note'),500))
            if not claimed:return core.j({'error':'already_decided'},409)
            await conn.execute('''UPDATE users SET account_status=$2,status_updated_at=NOW(),status_reason=$3
                WHERE id=$1''',request['user_id'],'active' if decision=='approve' else 'rejected',
                None if decision=='approve' else clip(b.get('note'),500))
            await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
               VALUES($1,$2,'user',$3,$4::jsonb)''',actor['auditUserId'],
               'access.approved' if decision=='approve' else 'access.rejected',str(request['user_id']),
               json.dumps({'source':'telegram_bot','actorTelegramId':actor['telegramUserId'],'requestId':str(request['id'])}))
            await conn.execute('''INSERT INTO notifications(user_id,type,title,body,href)
              VALUES($1,$2,$3,$4,$5)''',request['user_id'],
              'ACCESS_APPROVED' if decision=='approve' else 'ACCESS_REJECTED',
              'Access approved' if decision=='approve' else 'Access rejected',
              'Your Learners Area access has been approved. Welcome in.' if decision=='approve' else (clip(b.get('note'),500) or 'Your access request was not approved.'),
              '/app' if decision=='approve' else '/pending')
        return core.j({'success':True,'status':'active' if decision=='approve' else 'rejected','userId':str(request['user_id'])})

def install():core.app.include_router(router)
