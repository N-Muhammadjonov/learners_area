"""Internal bot callback for website ownership transfer.
Database lock, explicit actor/purpose/expiry checks and single-transaction role swap.
"""
from __future__ import annotations
import json
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_preferences_port import valid_actor
from .step26_owner_handover import effective,audit,notice
router=APIRouter()

def denial(code):
    status=404 if code=='not_found' else 403 if code=='wrong_actor' else 400 if code=='wrong_purpose' else 409
    return core.j({'error':code},status)

@router.post('/api/internal/telegram/owner/transfer')
async def owner_transfer_callback(req:Request):
    err=verify_bot(req)
    if err is not None:return err
    b=await core.payload(req);b=b if isinstance(b,dict) else {}
    cid=core.uuid_value(b.get('challengeId'))
    actor=b.get('actorTelegramId')
    decision=b.get('decision')
    if not cid or not isinstance(actor,str) or not valid_actor(actor) or decision not in ('approve','reject') or 'username' in b or 'password' in b:
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as c:
        async with c.transaction():
            challenge=await c.fetchrow('SELECT * FROM ownership_transfer_challenges WHERE id=$1 FOR UPDATE',cid)
            if not challenge:return denial('not_found')
            if challenge['telegram_user_id']!=actor:return denial('wrong_actor')
            if challenge['purpose']!='website_owner_transfer':return denial('wrong_purpose')
            state=challenge['status'];now=datetime.now(timezone.utc)
            if state in ('consumed','approved'):
                return core.j({'ok':True,'already':True}) if decision=='approve' else denial('replay')
            if state in ('rejected','cancelled'):return denial(state)
            if state=='expired' or now>=challenge['expires_at']:
                if state=='pending':await c.execute("UPDATE ownership_transfer_challenges SET status='expired' WHERE id=$1",cid)
                return denial('expired')
            if state!='pending':return denial('replay')
            if decision=='reject':
                changed=await c.fetchval("UPDATE ownership_transfer_challenges SET status='rejected',rejected_at=NOW() WHERE id=$1 AND status='pending' RETURNING id",cid)
                if not changed:return denial('replay')
                result={'ok':True,'rejected':True}
                kind='ownership.transfer_rejected'
            else:
                ids=sorted([challenge['from_user_id'],challenge['to_user_id']])
                rows=await c.fetch('SELECT id,role,account_status,telegram_id,name FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',ids)
                users={r['id']:r for r in rows}
                old=users.get(challenge['from_user_id']); target=users.get(challenge['to_user_id'])
                reason=(
                    'aborted' if not old or old['role']!='owner' or old['account_status']!='active' or old['telegram_id']!=actor
                    else 'target_not_active' if not target or target['id']==old['id'] or target['account_status']!='active'
                    else 'aborted' if challenge['requested_keep_role'] not in ('admin','teacher','student')
                    else None)
                if not reason and challenge['include_bot_handover']:
                    tg=challenge['target_telegram_id']
                    if not tg or not target['telegram_id'] or target['telegram_id']!=tg:reason='target_telegram_missing'
                    else:
                        contact=await c.fetchrow('''SELECT telegram_user_id FROM telegram_contacts
                            WHERE telegram_user_id=$1 AND removed_at IS NULL AND bot_blocked_at IS NULL''',tg)
                        if not contact:reason='target_telegram_missing'
                        else:
                            await c.execute("SELECT pg_advisory_xact_lock(hashtext('learners-area-owner-authority'))")
                            if await effective(c)!=actor:reason='bot_owner_mismatch'
                if reason:
                    await c.execute("UPDATE ownership_transfer_challenges SET status='cancelled',cancelled_at=NOW() WHERE id=$1",cid)
                    return denial(reason)
                await c.execute("UPDATE users SET role='owner' WHERE id=$1",target['id'])
                await c.execute('UPDATE users SET role=$2 WHERE id=$1',old['id'],challenge['requested_keep_role'])
                await c.execute('''INSERT INTO ownership_transfers(from_user_id,to_user_id,previous_owner_role)
                  VALUES($1,$2,$3)''',old['id'],target['id'],challenge['requested_keep_role'])
                owner_count=await c.fetchval("SELECT count(*)::int FROM users WHERE role='owner' AND account_status='active'")
                if owner_count!=1:raise RuntimeError('owner_invariant')
                consumed=await c.fetchval('''UPDATE ownership_transfer_challenges SET status='consumed',approved_at=NOW(),consumed_at=NOW()
                   WHERE id=$1 AND status='pending' AND expires_at>NOW() RETURNING id''',cid)
                if not consumed:raise RuntimeError('replay')
                await c.execute("UPDATE ownership_transfer_challenges SET status='cancelled',cancelled_at=NOW() WHERE from_user_id=$1 AND status='pending'",old['id'])
                if challenge['include_bot_handover']:
                    await c.execute("UPDATE telegram_owner_handovers SET status='cancelled',cancelled_at=NOW() WHERE from_telegram_id=$1 AND status IN ('pending','current_confirmed')",actor)
                    hand=await c.fetchrow('''INSERT INTO telegram_owner_handovers(from_telegram_id,to_telegram_id,initiated_by_user_id,status,current_confirmed_at,expires_at)
                      VALUES($1,$2,$3,'current_confirmed',NOW(),NOW()+interval '5 minutes') RETURNING id''',actor,target['telegram_id'],old['id'])
                else:hand=None
                result={'ok':True,'committed':True}
                kind='ownership.transferred'
        # Side effects occur only after the transfer transaction commits.
        await audit(c,challenge['from_user_id'],kind,challenge['to_user_id'],{'challengeId':str(cid),'telegramUserId':actor})
        if decision=='approve' and hand:
            await notice(c,target['telegram_id'],'telegram.owner_handover_target','Accept bot control',
             'Accept Learners Area bot control. This does not detect or change @BotFather ownership. Expires in 5 minutes.',hand['id'])
        if decision=='approve':
            # Session revocation is a separate side effect as in the TS service.
            await c.execute('UPDATE users SET auth_version=auth_version+1 WHERE id=ANY($1::uuid[])',ids)
    return core.j(result)

def install():core.app.include_router(router)
