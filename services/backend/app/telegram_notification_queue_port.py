"""Telegram outbox claim and delivery-result processing.

Intended behavioral match: Telegram notifications POST, `notifications.ts`.
The route is service-token-only and never delivers Telegram messages itself.
"""
from __future__ import annotations
from datetime import timedelta, datetime, timezone
from uuid import UUID
from fastapi import APIRouter,Request
from . import main as core
from .internal_bot_ready_port import verify_bot

router=APIRouter()

@router.post('/api/internal/telegram/notifications')
async def queue_notifications(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    body=await core.payload(req)
    body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        if isinstance(body.get('results'),list):
            # TypeScript flatMap silently removes invalid result rows and caps writes at 50.
            cleaned=[]
            for value in body['results']:
                if not isinstance(value,dict):continue
                if not isinstance(value.get('id'),str) or value.get('status') not in ('sent','failed','blocked'):continue
                cleaned.append(value)
            for value in cleaned[:50]:
                # DB uuid type errors for malformed id in original are propagated.
                retry_seconds=value.get('retryAfterSeconds')
                retry=(value['status']=='failed' and type(retry_seconds) in (int,float)
                       and 0<retry_seconds<3600)
                if retry:
                    await conn.execute('''UPDATE telegram_notifications SET status='queued',
                      error_message=$2,sent_at=NULL,next_attempt_at=NOW()+($3 * interval '1 second'),lease_until=NULL
                      WHERE id=$1::uuid''',value['id'],value.get('error')[:300] if isinstance(value.get('error'),str) else None,retry_seconds)
                else:
                    await conn.execute('''UPDATE telegram_notifications SET status=$2,
                      error_message=$3,sent_at=(CASE WHEN $2='sent' THEN NOW() ELSE NULL END),
                      next_attempt_at=NULL,lease_until=NULL WHERE id=$1::uuid''',
                      value['id'],value['status'],value.get('error')[:300] if isinstance(value.get('error'),str) else None)
            return core.j({'ok':True})
        requested=body.get('limit')
        # Number type in JS includes floating point; size coerced by SQL query limit.
        if type(requested) not in (int,float) or not (float('-inf')<requested<float('inf')): requested=15
        size=int(min(max(requested,1),30))
        rows=await conn.fetch('''SELECT id FROM telegram_notifications WHERE
           (status='queued' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
           OR (status='sending' AND lease_until <= NOW()) LIMIT $1''',size)
        if not rows:return core.j({'notices':[]})
        ids=[r['id'] for r in rows]
        claimed=await conn.fetch('''UPDATE telegram_notifications SET status='sending',
          lease_until=NOW()+INTERVAL '90 seconds', attempts=attempts+1
          WHERE id=ANY($1::uuid[]) AND status IN ('queued','sending')
          RETURNING id,telegram_user_id,title,body,category,type,correlation_id''',ids)
        contacts=await conn.fetch('''SELECT telegram_user_id,chat_id,bot_blocked_at,removed_at
          FROM telegram_contacts WHERE telegram_user_id=ANY($1::text[])''',
          [row['telegram_user_id'] for row in claimed]) if claimed else []
        contacts_by_user={r['telegram_user_id']:r for r in contacts}
        notices=[]
        for row in claimed:
            c=contacts_by_user.get(row['telegram_user_id'])
            unavailable=(not c or bool(c['bot_blocked_at']) or bool(c['removed_at']))
            notices.append({'id':str(row['id']),
                            'chatId':None if unavailable else c['chat_id'] or row['telegram_user_id'],
                            'title':row['title'],'body':row['body'],
                            'category':row['category'],'type':row['type'],
                            'correlationId':row['correlation_id'],'unavailable':bool(unavailable)})
    return core.j({'notices':notices})

def install():core.app.include_router(router)
