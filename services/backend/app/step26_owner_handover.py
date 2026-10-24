"""Internal Telegram ownership callbacks, ported from owner-handover and owner-transfer.
Both operations use transaction-scoped authority locks and check stale/expired state.
"""
from __future__ import annotations
import json,os,re
from datetime import datetime,timedelta,timezone
from fastapi import APIRouter,Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_preferences_port import valid_actor
router=APIRouter()
TTL=timedelta(minutes=5)

async def effective(conn):
    row=await conn.fetchrow("SELECT value FROM telegram_bot_settings WHERE key='primary_owner_telegram_id'")
    value=row['value'] if row else None
    if isinstance(value,str):
        try:value=json.loads(value)
        except ValueError:pass
    if isinstance(value,dict):value=value.get('telegramUserId')
    if isinstance(value,str) and valid_actor(value):return value
    fb=os.getenv('TELEGRAM_OWNER_ID','').strip()
    return fb if valid_actor(fb) else None

async def audit(conn,actor,action,target,metadata):
    await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
        VALUES($1,$2,$3,$4,$5::jsonb)''',actor,action,'telegram_owner' if action.startswith('telegram.') else 'user',str(target),json.dumps(metadata))

async def notice(conn,tg,typ,title,body,correlation):
    await conn.execute('''INSERT INTO telegram_notifications(telegram_user_id,type,title,body,category,correlation_id,status)
       VALUES($1,$2,$3,$4,'critical',$5,'queued')''',tg,typ,title,body,str(correlation))

def error(code):
    return core.j({'error':code},404 if code in ('not_found','target_unknown') else 403 if code in ('forbidden','wrong_actor') else 400 if code in ('invalid_actor','wrong_purpose') else 409)

@router.post('/api/internal/telegram/owner/handover')
async def handover(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    b=await core.payload(req); b=b if isinstance(b,dict) else {}
    actor=b.get('actorTelegramId') if isinstance(b.get('actorTelegramId'),str) else ''
    if not valid_actor(actor) or 'password' in b or 'username' in b:return core.j({'error':'invalid_input'},400)
    action=b.get('action') if isinstance(b.get('action'),str) else ''
    if action=='start':
        target=b.get('targetTelegramId','')
        target=target.strip() if isinstance(target,str) else ''
        db=await core.pool()
        async with db.acquire() as c:
            owner=await effective(c)
            if owner!=actor:return error('forbidden')
            if not valid_actor(target):return error('invalid_actor')
            if actor==target:return error('already_owner')
            known=await c.fetchrow('''SELECT telegram_user_id FROM telegram_contacts WHERE telegram_user_id=$1
                AND removed_at IS NULL AND bot_blocked_at IS NULL''',target)
            if not known:return error('target_unknown')
            async with c.transaction():
                await c.execute("SELECT pg_advisory_xact_lock(hashtext('learners-area-owner-authority'))")
                if await effective(c)!=actor:return error('forbidden')
                await c.execute('''UPDATE telegram_owner_handovers SET status='cancelled',cancelled_at=NOW()
                     WHERE from_telegram_id=$1 AND status IN ('pending','current_confirmed')''',actor)
                new=await c.fetchrow('''INSERT INTO telegram_owner_handovers(from_telegram_id,to_telegram_id,expires_at)
                    VALUES($1,$2,NOW()+interval '5 minutes') RETURNING id,expires_at''',actor,target)
            await audit(c,None,'telegram.owner_handover_started',target,
               {'handoverId':str(new['id']),'fromTelegramId':actor,'toTelegramId':target})
            await notice(c,actor,'telegram.owner_handover_current','Transfer bot control',
                f'Target Telegram ID: {target}\nThis is Learners Area bot control, not @BotFather ownership.\nExpires in 5 minutes.',new['id'])
        return core.j({'ok':True,'handoverId':str(new['id']),'expiresAt':new['expires_at'].isoformat().replace('+00:00','Z')},202)
    hid=core.uuid_value(b.get('handoverId'))
    if action not in ('current_confirm','target_accept','reject') or not hid:return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as c:
        async with c.transaction():
            await c.execute("SELECT pg_advisory_xact_lock(hashtext('learners-area-owner-authority'))")
            row=await c.fetchrow('SELECT * FROM telegram_owner_handovers WHERE id=$1 FOR UPDATE',hid)
            if not row:return error('not_found')
            fromid=row['from_telegram_id'];toid=row['to_telegram_id'];status=row['status'];now=datetime.now(timezone.utc)
            if actor not in (fromid,toid):return error('wrong_actor')
            if status=='consumed':return core.j({'ok':True,'already':True}) if action=='target_accept' and actor==toid else error('replay')
            if status in ('rejected','cancelled'):return error(status)
            if status=='expired' or now>=row['expires_at']:
                if status in ('pending','current_confirmed'):
                    await c.execute("UPDATE telegram_owner_handovers SET status='expired' WHERE id=$1",hid)
                return error('expired')
            if action=='reject':
                if status not in ('pending','current_confirmed'):return error('replay')
                await c.execute("UPDATE telegram_owner_handovers SET status='rejected',rejected_at=NOW() WHERE id=$1",hid)
                result={'ok':True,'rejected':True};event='telegram.owner_handover_rejected'
            elif action=='current_confirm':
                if actor!=fromid:return error('wrong_actor')
                if status!='pending':return error('replay')
                if await effective(c)!=fromid:
                    await c.execute("UPDATE telegram_owner_handovers SET status='cancelled',cancelled_at=NOW() WHERE id=$1",hid)
                    return error('stale_owner')
                await c.execute("UPDATE telegram_owner_handovers SET status='current_confirmed',current_confirmed_at=NOW(),expires_at=NOW()+interval '5 minutes' WHERE id=$1",hid)
                result={'ok':True,'confirmed':True};event='telegram.owner_handover_current_confirmed'
            else:
                if actor!=toid:return error('wrong_actor')
                if status!='current_confirmed':return error('not_ready')
                if await effective(c)!=fromid:
                    await c.execute("UPDATE telegram_owner_handovers SET status='cancelled',cancelled_at=NOW() WHERE id=$1",hid)
                    return error('stale_owner')
                known=await c.fetchrow('''SELECT telegram_user_id FROM telegram_contacts WHERE telegram_user_id=$1
                   AND removed_at IS NULL AND bot_blocked_at IS NULL''',toid)
                if not known:
                    await c.execute("UPDATE telegram_owner_handovers SET status='cancelled',cancelled_at=NOW() WHERE id=$1",hid)
                    return error('target_unknown')
                await c.execute('''INSERT INTO telegram_bot_settings(key,value,updated_at,updated_by_telegram_id)
                    VALUES('primary_owner_telegram_id',$1::jsonb,NOW(),$2)
                    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW(),updated_by_telegram_id=EXCLUDED.updated_by_telegram_id''',
                    json.dumps({'telegramUserId':toid,'previousTelegramUserId':fromid}),actor)
                await c.execute("UPDATE telegram_owner_handovers SET status='consumed',target_confirmed_at=NOW(),consumed_at=NOW() WHERE id=$1",hid)
                result={'ok':True,'committed':True};event='telegram.owner_transferred'
        await audit(c,row['initiated_by_user_id'],event,toid,{'handoverId':str(hid),'fromTelegramId':fromid,'toTelegramId':toid})
        if action=='current_confirm':
            await notice(c,toid,'telegram.owner_handover_target','Accept bot control',
             'Accept Learners Area bot control. This does not detect or change @BotFather ownership. Expires in 5 minutes.',hid)
        if action=='target_accept':
            await notice(c,fromid,'telegram.owner_transferred','Bot control transferred',
             'You are no longer the Learners Area bot owner. @BotFather ownership is unchanged.',hid)
            await notice(c,toid,'telegram.owner_transferred','Bot control is yours',
             'You are now the Learners Area bot owner. This is not @BotFather ownership.',hid)
    return core.j(result)

def install():core.app.include_router(router)
