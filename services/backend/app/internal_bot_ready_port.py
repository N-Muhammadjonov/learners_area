"""Telegram bot readiness with bearer constant-time auth and schema/RLS gate."""
import os,hashlib,hmac
from fastapi import APIRouter,Request
from . import main as core
router=APIRouter()


def verify_bot(req):
    h=req.headers.get('authorization','')
    if not h.startswith('Bearer '):return core.j({'error':'unauthorized'},401)
    secret=os.getenv('BOT_SERVICE_SECRET')
    if not secret:return core.j({'error':'internal_error'},500)
    token=h[len('Bearer '):]
    if not token or not hmac.compare_digest(hashlib.sha256(token.encode()).digest(),hashlib.sha256(secret.encode()).digest()):
        return core.j({'error':'unauthorized'},401)
    return None

@router.get('/api/internal/telegram/ready')
async def telegram_ready(req:Request):
    error=verify_bot(req)
    if error is not None:return error
    if (len(os.getenv('AUTH_SECRET',''))<16 or not os.getenv('TELEGRAM_BOT_TOKEN')
        or not os.getenv('TELEGRAM_BOT_USERNAME')):
        return core.j({'ok':False},503)
    try:
        db=await core.pool()
        async with db.acquire() as conn:
            for sql in ('''select token_hash, browser_nonce_hash, purpose from telegram_login_intents limit 0''',
                        '''select phone_number, phone_verified_at, linked_user_id from telegram_contacts limit 0''',
                        '''select permissions, is_active from telegram_bot_admins limit 0''',
                        '''select key, value from telegram_bot_settings limit 0''',
                        '''select status from ownership_transfer_challenges limit 0''',
                        '''select status from telegram_owner_handovers limit 0''',
                        '''select payload from telegram_flow_drafts limit 0'''):
                await conn.execute(sql)
            n=await conn.fetchval('''select count(*)::int from pg_class where relkind='r' and relrowsecurity
              and relnamespace='public'::regnamespace and relname in
              ('telegram_bot_admins','telegram_broadcast_deliveries','telegram_broadcasts','telegram_contacts',
              'telegram_login_intents','telegram_support_messages','telegram_support_threads','telegram_bot_settings',
              'telegram_deletion_intents','telegram_direct_messages','telegram_notifications','telegram_processed_updates',
              'telegram_flow_drafts','ownership_transfer_challenges','telegram_owner_handovers')''')
            if int(n)!=15:return core.j({'ok':False},503)
    except Exception:return core.j({'ok':False},503)
    return core.j({'ok':True})

def install():core.app.include_router(router)
