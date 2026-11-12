"""One-time Telegram intent exchange into an ordinary website session.

Derived from src/lib/auth/telegram-{exchange,intent}.ts. Login never creates an
account; link and replacement require the exact same signed-in user authority.
"""
from __future__ import annotations
import hashlib,re
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .db import PooledReads
from .rate_limit import RULES,async_counter as counter,too_many,client_key
from .telegram_preferences_port import valid_actor
from .step18_telegram_admission_port import gates
router=APIRouter()

class IntentNotConsumable(Exception):
    """Abort account/admission writes when the one-time consume cannot commit."""

def full_name(name):
    return isinstance(name,str) and 3<=len(name.strip())<=200 and re.fullmatch(r'\S+(?:\s+\S+)+',name.strip()) is not None

def fail(code):
    status=404 if code=='no_linked_account' else 403 if code in ('phone_required','not_subscribed') else 503 if code=='membership_unavailable' else 409 if code in ('conflict','already_consumed') else 400
    return core.j({'error':'telegram_already_linked' if code=='conflict' else code},status)


def intent_problem(intent):
    if not intent:return 'intent_not_confirmed'
    if intent['status']=='consumed':return 'already_consumed'
    if intent['status']!='confirmed' or not valid_actor(intent['telegram_user_id']):return 'intent_not_confirmed'
    if intent['expires_at']<=datetime.now(timezone.utc):return 'expired'
    return None

@router.post('/api/auth/telegram/intent/exchange')
async def intent_exchange(req:Request):
    RULES.setdefault('telegram_auth',(20,900))
    retry=await counter('telegram_auth',client_key(req),consume=True)
    if retry:return too_many(retry)
    b=await core.payload(req)
    b=b if isinstance(b,dict) else {}
    iid=b.get('intentId');nonce=b.get('browserNonce');gender=b.get('gender')
    if (gender is not None and gender not in ('male','female')) or not isinstance(nonce,str) or not isinstance(iid,str) or not core.uuid_value(iid):
        return core.j({'error':'invalid_input'},400)
    actor=await core.current_authority(req)
    nonce_hash=hashlib.sha256(nonce.encode()).hexdigest()
    db=await core.pool()
    try:
        reads=PooledReads(db)
        preview=await reads.fetchrow('''SELECT * FROM telegram_login_intents
          WHERE id=$1 AND browser_nonce_hash=$2''',iid,nonce_hash)
        problem=intent_problem(preview)
        if problem:return fail(problem)
        gated=await gates(reads,preview['telegram_user_id'])
        if gated:return fail(gated['error'])
        async with db.acquire() as con:
            async with con.transaction():
                intent=await con.fetchrow('''SELECT * FROM telegram_login_intents
                  WHERE id=$1 AND browser_nonce_hash=$2 FOR UPDATE''',iid,nonce_hash)
                problem=intent_problem(intent)
                if problem:return fail(problem)
                if any(intent[k]!=preview[k] for k in ('telegram_user_id','purpose','user_id')):return fail('intent_not_confirmed')
                tg=intent['telegram_user_id'];purpose=intent['purpose'] if intent['purpose'] in ('register','link','replace') else 'login'
                if purpose=='login':
                    user=await con.fetchrow('SELECT * FROM users WHERE telegram_id=$1',tg)
                    if not user:return fail('no_linked_account')
                    outcome='session'
                elif purpose in ('link','replace'):
                    if not intent['user_id'] or not actor or str(actor['user']['id'])!=str(intent['user_id']):return fail('missing_user')
                    target=await con.fetchrow('SELECT * FROM users WHERE id=$1 FOR UPDATE',intent['user_id'])
                    if not target:return fail('missing_user')
                    # Authority may change while membership I/O runs without a
                    # pool lease. Check both the epoch and exact-session logout.
                    if target['auth_version']!=actor['authVersion'] or await con.fetchval('''SELECT EXISTS(
                      SELECT 1 FROM auth_session_revocations WHERE token_hash=$1 AND user_id=$2 AND expires_at>NOW())''',
                      actor['sessionKey'],target['id']):return core.auth_error()
                    other=await con.fetchval('SELECT id FROM users WHERE telegram_id=$1',tg)
                    if other and other!=target['id']:return fail('conflict')
                    if purpose=='replace':
                        if target['auth_version']!=actor['authVersion'] or target['account_status']!='active':return fail('missing_user')
                        if target['role']!='student':return fail('change_not_available')
                        contact=await con.fetchrow('SELECT * FROM telegram_contacts WHERE telegram_user_id=$1 FOR UPDATE',tg)
                        if not contact or not contact['phone_verified_at'] or not contact['phone_number']:return fail('phone_required')
                        if contact['linked_user_id'] and contact['linked_user_id']!=target['id']:return fail('conflict')
                        if target['telegram_id']!=tg:
                            if target['telegram_id']:
                                await con.execute('''UPDATE telegram_contacts SET linked_user_id=NULL,updated_at=NOW()
                                  WHERE telegram_user_id=$1 AND linked_user_id=$2''',target['telegram_id'],target['id'])
                            await con.execute('UPDATE users SET telegram_id=$2,auth_version=auth_version+1 WHERE id=$1',target['id'],tg)
                    else:
                        if target['telegram_id'] and target['telegram_id']!=tg:return fail('conflict')
                        if not other:
                            await con.execute('UPDATE users SET telegram_id=$2 WHERE id=$1 AND (telegram_id IS NULL OR telegram_id=$2)',target['id'],tg)
                    await con.execute('UPDATE telegram_contacts SET linked_user_id=$2,updated_at=NOW() WHERE telegram_user_id=$1',tg,target['id'])
                    user=await con.fetchrow('SELECT * FROM users WHERE id=$1',target['id']);outcome='session'
                else:
                    previous=await con.fetchrow('SELECT * FROM users WHERE telegram_id=$1',tg)
                    if previous:
                        can_edit=previous['account_status'] in ('pending','rejected') and not previous['onboarding_completed_at']
                        if can_edit and (gender and previous['gender'] is None or full_name(b.get('name'))):
                            user=await con.fetchrow('''UPDATE users SET gender=COALESCE(gender,$2),
                             name=COALESCE($3,name) WHERE id=$1 RETURNING *''',previous['id'],gender,
                             b['name'].strip() if full_name(b.get('name')) else None)
                        else:user=previous
                        outcome='existing'
                    else:
                        if not full_name(b.get('name')):return fail('full_name_required')
                        if gender not in ('male','female'):return fail('gender_required')
                        user=await con.fetchrow('''INSERT INTO users(telegram_id,name,gender,role,account_status,locale)
                          VALUES($1,$2,$3,'student','pending',$4) RETURNING *''',tg,b['name'].strip(),gender,
                          'en' if intent['language_code']=='en' else 'uz')
                        outcome='created'
                if outcome!='session':
                    if user['account_status']=='active':outcome='already_active'
                    elif user['account_status']=='suspended':outcome='suspended'
                    else:
                        opened=await con.fetchval('''SELECT id FROM access_requests WHERE user_id=$1 AND status='pending'
                             ORDER BY created_at DESC LIMIT 1''',user['id'])
                        if opened:outcome='already_pending'
                        else:
                            previous_rejected=user['account_status']=='rejected'
                            await con.execute("INSERT INTO access_requests(user_id,status) VALUES($1,'pending')",user['id'])
                            await con.execute("UPDATE users SET account_status='pending',status_updated_at=NOW() WHERE id=$1",user['id'])
                            user=await con.fetchrow('SELECT * FROM users WHERE id=$1',user['id'])
                            outcome='reopened' if previous_rejected else 'pending'
                # Keep the intent row lock until ALL related writes commit.
                token=core.issue_token(dict(user))
                consumed=await con.fetchval('''UPDATE telegram_login_intents SET status='consumed',consumed_at=NOW()
                    WHERE id=$1 AND browser_nonce_hash=$2 AND status='confirmed' AND expires_at>NOW()
                    RETURNING id''',iid,nonce_hash)
                if not consumed:raise IntentNotConsumable()
        resp=core.j({'success':True,'onboarded':bool(user['onboarding_completed_at']),
                     'accountStatus':user['account_status'],'role':user['role'],'outcome':outcome})
        core.clear_session_cookie(resp,req)
        core.write_cookie(resp,req,core.SESSION_COOKIE,token,core.SESSION_TTL,http_only=True)
        return resp
    except IntentNotConsumable:
        return fail('already_consumed')
    except Exception:
        return core.j({'error':'internal_error'},500)

def install():core.app.include_router(router)

