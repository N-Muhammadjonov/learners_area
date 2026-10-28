"""Two legacy Telegram auth routes. Direct conversion of callback and bot confirmation.

Do not treat browser-provided Telegram fields as authenticated; HMAC signature required.
"""
from __future__ import annotations
import os,re,json,hashlib,hmac,time
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from . import main as core
from .internal_bot_ready_port import verify_bot
router=APIRouter()


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
    db=await core.pool()
    async with db.acquire() as con:
        from .step18_telegram_admission_port import gates
        gated=await gates(con,str(int(params['id'])))
        if gated:return redirect('/login?error=telegram_'+gated['error'])
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
        if not token or len(token)>200 or not valid_actor(tg):return core.j({'error':'invalid_input'},400)
        name=b.get('displayName','')
        name=(name.strip()[:200] if isinstance(name,str) else '')
        lang=b.get('languageCode') if b.get('languageCode') in ('en','uz') else None
        hashed=hashlib.sha256(token.encode()).hexdigest()
        db=await core.pool()
        async with db.acquire() as con:
            pending=await con.fetchrow('''SELECT id,user_id,telegram_user_id FROM telegram_login_intents
              WHERE token_hash=$1 AND status='pending' AND expires_at>NOW() LIMIT 1''',hashed)
            if not pending:return core.j({'error':'intent_invalid'},404)
            if pending.get('telegram_user_id') not in (None,tg):return core.j({'error':'intent_invalid'},409)
            from .step18_telegram_admission_port import gates
            gated=await gates(con,tg)
            if gated:return core.j(gated,403 if gated['error'] in ('phone_required','not_subscribed') else 503)
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
    from .rate_limit import RULES,counter,too_many
    if len(token)>200 or not valid_actor(tg):
        return core.j({'error':'invalid_input'},400)
    RULES.setdefault('telegram_auth_preflight',(20,900))
    delay=counter('telegram_auth_preflight','tg:'+tg,consume=True)
    if delay:return too_many(delay)
    db=await core.pool()
    async with db.acquire() as con:
        if token:
            hashed=hashlib.sha256(token.encode()).hexdigest()
            pending=await con.fetchrow('''SELECT purpose,telegram_user_id FROM telegram_login_intents
              WHERE token_hash=$1 AND status='pending' AND expires_at>NOW() LIMIT 1''',hashed)
            if not pending:return core.j({'error':'intent_invalid'},404)
            if pending.get('telegram_user_id') not in (None,tg):return core.j({'error':'intent_invalid'},409)
        from .step18_telegram_admission_port import gates
        gated=await gates(con,tg)
        # Retain the verified Telegram actor while membership is pending so the
        # nonce-bound browser can show the gate instead of waiting silently.
        if token and (not gated or gated['error']!='phone_required'):
            bound=await con.fetchval('''UPDATE telegram_login_intents SET telegram_user_id=$2
              WHERE token_hash=$1 AND status='pending' AND expires_at>NOW()
                AND (telegram_user_id IS NULL OR telegram_user_id=$2) RETURNING id''',hashed,tg)
            if not bound:return core.j({'error':'intent_invalid'},409)
        if gated:
            code=gated['error']
            return core.j(gated,403 if code in ('phone_required','not_subscribed') else 503)
    return core.j({'ok':True})

def install():core.app.include_router(router)

