"""Bot-only, two-step account anonymisation with single-use SHA-256 challenge.

Port of telegram/directory.ts startDeletion()/confirmDeletion().
"""
from __future__ import annotations
import hashlib, json, re, secrets
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_admins_port import actor_for,denied_response,effective_owner_id,audit
router = APIRouter()

async def safe_target(conn, uid):
    person=await conn.fetchrow('SELECT id,telegram_id,role,account_status FROM users WHERE id=$1',uid)
    if not person:return None,'not_found'
    if (person['telegram_id'] and person['telegram_id']==await effective_owner_id(conn)) or person['role']=='owner':
        # Source also guards the last owner; deletion refuses all owners before mutating.
        return None,'primary_owner_protected'
    return person,None

@router.post('/api/internal/telegram/directory/{userId}/delete')
async def delete_from_bot(req:Request,userId:str):
    bot=verify_bot(req)
    if bot is not None:return bot
    if not core.uuid_value(userId):return core.j({'error':'not_found'},404)
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as con:
        actor,error=await actor_for(con,body.get('actorTelegramId'),'DANGEROUS_USER_DELETE',audit_required=True)
        if error:return denied_response(error)
        user,error=await safe_target(con,userId)
        if error:return core.j({'error':error},404 if error=='not_found' else 409)
        if body.get('confirm') is True:
            code=body.get('code') if isinstance(body.get('code'),str) else ''
            if not re.fullmatch(r'\d{6}',code):return core.j({'error':'invalid_code'},400)
            hashed=hashlib.sha256(f"{actor['telegramUserId']}:{userId}:{code}".encode()).hexdigest()
            async with con.transaction():
                claimed=await con.fetchval('''UPDATE telegram_deletion_intents SET consumed_at=NOW()
                  WHERE target_user_id=$1 AND actor_telegram_id=$2 AND token_hash=$3
                  AND consumed_at IS NULL AND expires_at>NOW() RETURNING id''',userId,actor['telegramUserId'],hashed)
                if not claimed:return core.j({'error':'challenge_invalid'},409)
                await con.execute('''UPDATE users SET name='Former student',email=NULL,telegram_id=NULL,
                   password_hash=NULL,account_status='suspended',status_reason='anonymised_by_owner',
                   status_updated_at=NOW() WHERE id=$1''',userId)
                if user['telegram_id']:
                    await con.execute('''UPDATE telegram_contacts SET linked_user_id=NULL,username=NULL,
                      first_name=NULL,last_name=NULL,phone_number=NULL,phone_verified_at=NULL,
                      removed_at=NOW(),updated_at=NOW() WHERE telegram_user_id=$1''',user['telegram_id'])
                await audit(con,actor,'account.anonymised','user',userId,{'mode':'retention_anonymise'})
            return core.j({'ok':True})
        code=f'{secrets.randbelow(1000000):06d}'
        hashed=hashlib.sha256(f"{actor['telegramUserId']}:{userId}:{code}".encode()).hexdigest()
        expiry=datetime.now(timezone.utc)+timedelta(minutes=10)
        row=await con.fetchval('''INSERT INTO telegram_deletion_intents(token_hash,target_user_id,actor_telegram_id,expires_at)
          VALUES($1,$2,$3,$4) RETURNING id''',hashed,userId,actor['telegramUserId'],expiry)
        await audit(con,actor,'account.deletion_started','user',userId)
        return core.j({'ok':True,'challengeId':str(row),'code':code,
          'expiresAt':expiry.isoformat(timespec='milliseconds').replace('+00:00','Z')})

def install():core.app.include_router(router)
