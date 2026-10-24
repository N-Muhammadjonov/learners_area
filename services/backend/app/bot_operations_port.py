"""Small bot-only endpoints. Backend service auth is mandatory before database access."""
from __future__ import annotations
import re
from fastapi import APIRouter,Request
from . import main as core
from .internal_bot_ready_port import verify_bot
router=APIRouter()
_ID=re.compile(r'^[0-9]{1,32}$')
_PHONE=re.compile(r'^\+?[0-9]{7,18}$')
_TELEGRAM_ID=re.compile(r'^[0-9]{1,20}$')

@router.post('/api/internal/telegram/updates')
async def webhook_update(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    b=await core.payload(req)
    if not isinstance(b,dict):b={}
    val=b.get('updateId')
    # JavaScript String(number) loses trailing .0, and accepts numeric types not bools.
    update_id=str(val) if isinstance(val,str) else (str(val) if type(val) is int else str(val).removesuffix('.0') if type(val) is float else '')
    if not _ID.fullmatch(update_id):return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        row=await conn.fetchrow('''INSERT INTO telegram_processed_updates(update_id) VALUES($1)
           ON CONFLICT DO NOTHING RETURNING update_id''',update_id)
    return core.j({'fresh':bool(row)})

@router.post('/api/internal/telegram/contacts/phone')
async def bot_contact_phone(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    b=await core.payload(req)
    if not isinstance(b,dict):b={}
    tid=b.get('telegramUserId')
    if not isinstance(tid,str) or not _TELEGRAM_ID.fullmatch(tid) or b.get('contactUserId')!=tid:
        return core.j({'error':'contact_owner_mismatch'},403)
    raw=b.get('phoneNumber','')
    raw=raw.strip() if isinstance(raw,str) else ''
    cleaned=re.sub(r'[\s()\-]','',raw)
    if not _PHONE.fullmatch(cleaned):return core.j({'error':'invalid_phone'},400)
    phone=cleaned if cleaned.startswith('+') else '+'+cleaned
    db=await core.pool()
    async with db.acquire() as conn:
        updated=await conn.fetchrow('''UPDATE telegram_contacts SET phone_number=$2,
          phone_verified_at=NOW(),updated_at=NOW() WHERE telegram_user_id=$1 RETURNING telegram_user_id''',tid,phone)
    if not updated:return core.j({'error':'start_required'},409)
    return core.j({'ok':True})

def install():core.app.include_router(router)
