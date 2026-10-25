"""Broadcast admin, recipient creation, claim, receipt and cancellation port.
Source: src/lib/telegram/broadcast.ts and API route handlers. No actual Telegram send
is performed by these routes (the existing bot worker pulls the delivery lease).
"""
from __future__ import annotations
import json, math
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter,Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_admins_port import actor_for, denied_response, audit
from .telegram_preferences_port import jsonb, clip
from .rate_limit import RULES,counter,too_many
router=APIRouter()
AUDIENCES={'all_bot_users','active_students','pending_applicants','teachers','admins'}
RULES.setdefault('telegram_broadcast',(6,3600))


def iso(value):
    return value.isoformat(timespec='milliseconds').replace('+00:00','Z') if value else None


async def recipients(conn,audience):
    if audience=='all_bot_users':
        return await conn.fetch('''SELECT telegram_user_id,chat_id FROM telegram_contacts
          WHERE removed_at IS NULL AND bot_blocked_at IS NULL''')
    roles={'admins':['admin','owner'],'teachers':['teacher'],
           'pending_applicants':['student'],'active_students':['student']}[audience]
    status='pending' if audience=='pending_applicants' else 'active'
    return await conn.fetch('''SELECT c.telegram_user_id,c.chat_id FROM telegram_contacts c
      INNER JOIN users u ON u.id=c.linked_user_id WHERE c.removed_at IS NULL AND c.bot_blocked_at IS NULL
      AND u.role::text=ANY($1::text[]) AND u.account_status=$2''',roles,status)


@router.post('/api/internal/telegram/broadcasts')
async def broadcasts(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'BROADCAST')
        if error:return denied_response(error)
        audience=body.get('audience')
        if audience not in AUDIENCES:return core.j({'error':'invalid_audience'},400)
        if body.get('preview') is True:
            rows=await recipients(conn,audience)
            return core.j({'audience':audience,'recipientCount':len(rows)})
        delay=counter('telegram_broadcast','broadcast:'+actor['telegramUserId'],consume=True)
        if delay:return too_many(delay)
        setting=await conn.fetchrow("SELECT value FROM telegram_bot_settings WHERE key='broadcasts_enabled'")
        if setting and jsonb(setting['value']) is False:return core.j({'error':'broadcasts_disabled'},403)
        content=clip(body.get('content'),4000) or ''
        if not content:return core.j({'error':'invalid_input'},400)
        recipients_rows=await recipients(conn,audience)
        row=await conn.fetchrow('''INSERT INTO telegram_broadcasts
          (created_by,actor_telegram_id,audience,content,status,recipient_count)
          VALUES($1,$2,$3,$4,'queued',$5) RETURNING id''',actor['auditUserId'],actor['telegramUserId'],audience,content,len(recipients_rows))
        if not row:return core.j({'error':'internal_error'},400)
        if recipients_rows:
            await conn.executemany('''INSERT INTO telegram_broadcast_deliveries
              (broadcast_id,telegram_user_id,chat_id,status) VALUES($1,$2,$3,'queued')''',[
                 (row['id'],r['telegram_user_id'],r['chat_id']) for r in recipients_rows])
        else:
            await conn.execute('''UPDATE telegram_broadcasts SET status='sent',completed_at=NOW(),updated_at=NOW() WHERE id=$1''',row['id'])
        await audit(conn,actor,'broadcast.created','telegram_broadcast',row['id'],
          {'audience':audience,'recipientCount':len(recipients_rows)})
        return core.j({'ok':True,'id':str(row['id']),'recipientCount':len(recipients_rows),
                       'status':'queued' if recipients_rows else 'sent'})


async def _id_guard(req,conn,id,actor_value):
    if not core.uuid_value(id):return None,core.j({'error':'not_found'},404)
    actor,error=await actor_for(conn,actor_value,'BROADCAST')
    return (actor,None) if not error else (None,denied_response(error))


@router.post('/api/internal/telegram/broadcasts/claim')
async def claim(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        if isinstance(body.get('results'),list):
            touched=set()
            for item in body['results'][:50]:
                if not isinstance(item,dict) or not isinstance(item.get('deliveryId'),str) or item.get('status') not in ('sent','failed','blocked'):
                    continue
                status=item['status']
                seconds=item.get('retryAfterSeconds')
                retry=(status=='failed' and type(seconds) in (int,float) and not math.isnan(seconds) and 0<seconds<3600)
                error=item.get('error') if isinstance(item.get('error'),str) else None
                telegram_id=item.get('telegramMessageId') if isinstance(item.get('telegramMessageId'),str) else None
                next_at=datetime.now(timezone.utc)+timedelta(seconds=seconds) if retry else None
                row=await conn.fetchrow('''UPDATE telegram_broadcast_deliveries SET status=$2,
                  error_message=$3,telegram_message_id=$4,delivered_at=CASE WHEN $5 THEN NOW() ELSE NULL END,
                  next_attempt_at=$6,lease_until=NULL WHERE id=$1 RETURNING broadcast_id''',item['deliveryId'],
                  'queued' if retry else status,error[:300] if error else None,telegram_id,status=='sent',next_at)
                if row:touched.add(str(row['broadcast_id']))
            for bid in touched:
                counts=await conn.fetchrow('''SELECT count(*) FILTER(WHERE status='sent')::int sent,
                 count(*) FILTER(WHERE status='failed')::int failed,
                 count(*) FILTER(WHERE status='blocked')::int blocked,
                 count(*) FILTER(WHERE status IN ('queued','sending'))::int open
                 FROM telegram_broadcast_deliveries WHERE broadcast_id=$1''',bid)
                done=counts['open']==0
                final='failed' if counts['failed']>0 and counts['sent']==0 else 'sent'
                await conn.execute('''UPDATE telegram_broadcasts SET sent_count=$2,failed_count=$3,
                  blocked_count=$4,status=$5,completed_at=CASE WHEN $6 THEN NOW() ELSE NULL END,
                  updated_at=NOW() WHERE id=$1 AND status IN ('queued','sending')''',bid,counts['sent'],
                  counts['failed'],counts['blocked'],final if done else 'sending',done)
            return core.j({'ok':True,'updated':len(touched)})
        size=body.get('limit')
        if type(size) not in (int,float) or math.isnan(size) or math.isinf(size):size=15
        size=max(1,min(30,int(size)))
        due=await conn.fetch('''SELECT d.id FROM telegram_broadcast_deliveries d
          JOIN telegram_broadcasts b ON b.id=d.broadcast_id
          WHERE b.status IN ('queued','sending')
            AND ((d.status='queued' AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=NOW()))
                 OR (d.status='sending' AND d.lease_until<=NOW()))
          LIMIT $1''',size)
        if not due:return core.j({'deliveries':[]})
        claimed=await conn.fetch('''UPDATE telegram_broadcast_deliveries SET status='sending',
          lease_until=NOW()+INTERVAL '90 seconds',attempts=attempts+1
          WHERE id=ANY($1::uuid[]) AND status IN ('queued','sending')
          RETURNING id,broadcast_id,chat_id,telegram_user_id''',[r['id'] for r in due])
        if not claimed:return core.j({'deliveries':[]})
        bids=list(set(r['broadcast_id'] for r in claimed))
        broadcasts=await conn.fetch('''SELECT id,content,message_type FROM telegram_broadcasts WHERE id=ANY($1::uuid[])''',bids)
        contents={r['id']:r for r in broadcasts}
        await conn.execute('''UPDATE telegram_broadcasts SET status='sending',updated_at=NOW()
         WHERE id=ANY($1::uuid[]) AND status='queued' ''',bids)
        return core.j({'deliveries':[{'deliveryId':str(r['id']),'chatId':r['chat_id'] or r['telegram_user_id'],
         'text':contents[r['broadcast_id']]['content'] if r['broadcast_id'] in contents else '',
         'messageType':contents[r['broadcast_id']]['message_type'] if r['broadcast_id'] in contents else 'text'} for r in claimed]})


@router.get('/api/internal/telegram/broadcasts/{id}')
async def status(req:Request,id:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await _id_guard(req,conn,id,req.query_params.get('actorTelegramId'))
        if error is not None:return error
        row=await conn.fetchrow('''SELECT id,audience,status,recipient_count,sent_count,failed_count,
          blocked_count,created_at,completed_at FROM telegram_broadcasts WHERE id=$1''',id)
        if not row:return core.j({'error':'not_found'},404)
        return core.j({'id':str(row['id']),'audience':row['audience'],'status':row['status'],
          'recipientCount':row['recipient_count'],'sentCount':row['sent_count'],
          'failedCount':row['failed_count'],'blockedCount':row['blocked_count'],
          'createdAt':iso(row['created_at']),'completedAt':iso(row['completed_at'])})


@router.post('/api/internal/telegram/broadcasts/{id}')
async def cancel(req:Request,id:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'BROADCAST')
        if error:return denied_response(error)
        if body.get('action')!='cancel':return core.j({'error':'invalid_input'},400)
        row=await conn.fetchrow('''UPDATE telegram_broadcasts SET status='cancelled',updated_at=NOW(),
           completed_at=NOW() WHERE id=$1 AND status IN ('queued','sending') RETURNING id''',id)
        if not row:return core.j({'error':'not_cancellable'},409)
        await conn.execute('''UPDATE telegram_broadcast_deliveries SET status='cancelled'
           WHERE broadcast_id=$1 AND status='queued' ''',id)
        await audit(conn,actor,'broadcast.cancelled','telegram_broadcast',id)
        return core.j({'ok':True})



def install():core.app.include_router(router)
