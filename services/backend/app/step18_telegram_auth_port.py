"""Two legacy Telegram auth routes. Direct conversion of callback and bot confirmation.

Do not treat browser-provided Telegram fields as authenticated; HMAC signature required.
"""
from __future__ import annotations
import os,re,json,hashlib,hmac,time
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from . import main as core
from .db import PooledReads
from .internal_bot_ready_port import verify_bot
from .rate_limit import RULES,async_counter as counter,too_many
router=APIRouter()
RULES.setdefault('telegram_callback',(40,900))


def telegram_verified(p):
    token=os.environ.get('TELEGRAM_BOT_TOKEN')
    if not token:return False
    try:
        uid=int(p['id']);ts=int(p['auth_date']);digest=p.get('hash','')
        if uid<=0 or ts<=0 or uid>2**53-1 or ts>2**53-1 or not re.fullmatch('[a-f0-9]{64}',digest):return False
        delta=time.time()-ts
        if not (-30<=delta<300):return False
        # Callback query strings are strings but the TS handler casts id/auth_date to numbers.
        values={**p,'id':uid,'auth_date':ts};values.pop('hash',None)
        check='\n'.join(f'{k}={values[k]}' for k in sorted(values))
        secret=hashlib.sha256(token.encode()).digest()
        expected=hmac.new(secret,check.encode(),hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected,digest)
    except (ValueError,TypeError,KeyError):return False

@router.get('/api/auth/telegram/callback')
async def telegram_callback(req:Request):
    params=dict(req.query_params)
    root=str(req.base_url).rstrip('/')
    def redirect(path):return RedirectResponse(root+path,status_code=307)
    if not telegram_verified(params):return redirect('/login?error=telegram')
    delay=await counter('telegram_callback','tg:'+str(int(params['id'])),consume=True)
    if delay:return too_many(delay)
    db=await core.pool()
    from .step18_telegram_admission_port import gates
    gated=await gates(PooledReads(db),str(int(params['id'])))
    if gated:return redirect('/login?error=telegram_'+gated['error'])
    async with db.acquire() as con:
        row=await con.fetchrow('''SELECT id,auth_version,role,name,locale,onboarding_completed_at
          FROM users WHERE telegram_id=$1 LIMIT 1''',str(int(params['id'])))
    if not row:return redirect('/register?error=telegram_no_account')
    token=core.issue_token({'id':row['id'],'auth_version':row['auth_version'],'role':row['role'],
       'name':row['name'],'locale':row['locale'],'onboarding_completed_at':row['onboarding_completed_at']})
    resp=redirect('/app' if row['onboarding_completed_at'] else '/onboarding')
    core.clear_session_cookie(resp,req)
    core.write_cookie(resp,req,core.SESSION_COOKIE,token,core.SESSION_TTL,http_only=True)
    return resp

@router.post('/api/internal/telegram/auth/confirm')
async def telegram_auth_confirm(req:Request):
    err=verify_bot(req)
    if err is not None:return err
    try:
        b=await core.payload(req)
        b=b if isinstance(b,dict) else {}
        token=b.get('token') if isinstance(b.get('token'),str) else ''
        tg=b.get('telegramUserId') if isinstance(b.get('telegramUserId'),str) else ''
        from .telegram_preferences_port import valid_actor
        if len(token)>200 or not valid_actor(tg) or (not token and not core.uuid_value(b.get('intentId'))):return core.j({'error':'invalid_input'},400)
        name=b.get('displayName','')
        name=(name.strip()[:200] if isinstance(name,str) else '')
        lang=b.get('languageCode') if b.get('languageCode') in ('en','uz') else None
        db=await core.pool()
        async with db.acquire() as con:
            from .telegram_auth_state import token_digest
            hashed=await token_digest(con,tg,token)
            if not hashed:return core.j({'error':'intent_invalid'},404)
            pending=await con.fetchrow('''SELECT id,user_id,telegram_user_id FROM telegram_login_intents
              WHERE token_hash=$1 AND status='pending' AND expires_at>NOW() LIMIT 1''',hashed)
            if not pending:return core.j({'error':'intent_invalid'},404)
            if not token and str(pending['id'])!=b['intentId']:return core.j({'error':'intent_invalid'},409)
            if pending.get('telegram_user_id') not in (None,tg):return core.j({'error':'intent_invalid'},409)
        from .step18_telegram_admission_port import gates
        gated=await gates(PooledReads(db),tg)
        if gated:return core.j(gated,403 if gated['error'] in ('phone_required','not_subscribed') else 503)
        async with db.acquire() as con:
            if pending['user_id']:
                target=await con.fetchrow('SELECT id,telegram_id FROM users WHERE id=$1',pending['user_id'])
                taken=await con.fetchrow('SELECT id FROM users WHERE telegram_id=$1',tg)
                if not target:return core.j({'error':'missing_user'},404)
                if (target['telegram_id'] and target['telegram_id']!=tg) or (taken and taken['id']!=target['id']):
                    return core.j({'error':'telegram_already_linked'},409)
            updated=await con.fetchval('''UPDATE telegram_login_intents
              SET status='confirmed',telegram_user_id=$2,display_name=$3,language_code=$4,confirmed_at=NOW()
              WHERE id=$1 AND status='pending' AND expires_at>NOW()
                AND (telegram_user_id IS NULL OR telegram_user_id=$2) RETURNING id''',pending['id'],tg,name or None,lang)
            if not updated:return core.j({'error':'intent_invalid'},409)
        return core.j({'success':True,'intentId':str(updated)})
    except Exception:
        return core.j({'error':'internal_error'},500)

@router.post('/api/internal/telegram/auth/preflight')
async def telegram_auth_preflight(req:Request):
    """Bot-only phone/channel gate for every auth purpose and direct bot starts."""
    err=verify_bot(req)
    if err is not None:return err
    b=await core.payload(req)
    b=b if isinstance(b,dict) else {}
    token=b.get('token') if isinstance(b.get('token'),str) else ''
    tg=b.get('telegramUserId') if isinstance(b.get('telegramUserId'),str) else ''
    from .telegram_preferences_port import valid_actor
    from .rate_limit import RULES,async_counter as counter,too_many
    if len(token)>200 or not valid_actor(tg):
        return core.j({'error':'invalid_input'},400)
    RULES.setdefault('telegram_auth_preflight',(20,900))
    delay=await counter('telegram_auth_preflight','tg:'+tg,consume=True)
    if delay:return too_many(delay)
    db=await core.pool()
    reads=PooledReads(db)
    from .telegram_auth_state import remember,forget,token_digest
    action=b.get('action')
    if action not in (None,'begin','cancel'):return core.j({'error':'invalid_input'},400)
    if action in ('begin','cancel'):
        async with db.acquire() as con:
            if action=='cancel' or not token:
                await forget(con,tg)
            elif not await remember(con,tg,token):
                return core.j({'error':'intent_invalid'},404)
        return core.j({'ok':True})
    hashed=await token_digest(reads,tg,token)
    pending=None
    if hashed:
        pending=await reads.fetchrow('''SELECT purpose,telegram_user_id,id FROM telegram_login_intents
          WHERE token_hash=$1 AND status='pending' AND expires_at>NOW() LIMIT 1''',hashed)
        if not pending:return core.j({'error':'intent_invalid'},404)
        if pending.get('telegram_user_id') not in (None,tg):return core.j({'error':'intent_invalid'},409)
    from .step18_telegram_admission_port import gates
    gated=await gates(reads,tg)
    # Retain the verified Telegram actor while membership is pending so the
    # nonce-bound browser can show the gate instead of waiting silently.
    if hashed and (not gated or gated['error']!='phone_required'):
        async with db.acquire() as con:
            bound=await con.fetchval('''UPDATE telegram_login_intents SET telegram_user_id=$2
              WHERE token_hash=$1 AND status='pending' AND expires_at>NOW()
                AND (telegram_user_id IS NULL OR telegram_user_id=$2) RETURNING id''',hashed,tg)
            if not bound:return core.j({'error':'intent_invalid'},409)
    if gated:
        code=gated['error']
        return core.j(gated,403 if code in ('phone_required','not_subscribed') else 503)
    return core.j({'ok':True,**({'intentId':str(pending['id'])} if pending and pending.get('id') else {})})

def install():core.app.include_router(router)

