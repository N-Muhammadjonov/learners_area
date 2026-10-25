"""Port of Telegram contact syncing, notification preferences, and primary-owner summary.

Source: src/lib/telegram/{contacts,notifications,owner-handover,owner-store,owner-authority}.ts
No frontend, Git, or external notification calls.
"""
from __future__ import annotations
import json
import os
import re
from fastapi import APIRouter, Request
from . import main as core
from .internal_bot_ready_port import verify_bot

router = APIRouter()
TG_ID = re.compile(r'^[0-9]{1,20}$')


def jsonb(value):
    if isinstance(value, str):
        try: return json.loads(value)
        except (ValueError, TypeError): return None
    return value


def clip(value, max_len):
    if not isinstance(value, str): return None
    result = value.strip()
    return result[:max_len] if result else None


def valid_actor(value):
    return isinstance(value, str) and bool(TG_ID.fullmatch(value))


async def preference_read(conn, telegram_id):
    row = await conn.fetchrow('''SELECT notification_prefs,locale_override,language_code
                                 FROM telegram_contacts WHERE telegram_user_id=$1''', telegram_id)
    prefs = (jsonb(row.get('notification_prefs')) or {}) if row else {}
    if not isinstance(prefs, dict): prefs = {}
    return {'locale': ((row.get('locale_override') or row.get('language_code')) if row else None) or 'uz',
            'announcements': prefs.get('announcements') is True,
            'reminders': prefs.get('reminders') is True,
            'accountNotices': True}


@router.get('/api/internal/telegram/notifications')
async def get_notifications(req: Request):
    rejected = verify_bot(req)
    if rejected is not None: return rejected
    actor = req.query_params.get('actorTelegramId', '')
    if not valid_actor(actor): return core.j({'error': 'invalid_actor'}, 400)
    db = await core.pool()
    async with db.acquire() as conn:
        result = await preference_read(conn, actor)
    return core.j(result)


@router.put('/api/internal/telegram/notifications')
async def put_notifications(req: Request):
    rejected = verify_bot(req)
    if rejected is not None: return rejected
    body = await core.payload(req)
    body = body if isinstance(body, dict) else {}
    actor = body.get('actorTelegramId')
    if not valid_actor(actor): return core.j({'error': 'invalid_actor'}, 400)
    db = await core.pool()
    async with db.acquire() as conn:
        current = await preference_read(conn, actor)
        next_prefs = {
            'announcements': body['announcements'] if type(body.get('announcements')) is bool else current['announcements'],
            'reminders': body['reminders'] if type(body.get('reminders')) is bool else current['reminders'],
        }
        locale = body.get('locale') if body.get('locale') in ('uz', 'en') else None
        # Drizzle does not update localeOverride when the input is undefined.
        await conn.execute('''UPDATE telegram_contacts SET notification_prefs=$2::jsonb,
                             locale_override=COALESCE($3,locale_override),updated_at=NOW()
                             WHERE telegram_user_id=$1''', actor, json.dumps(next_prefs), locale)
        return core.j({**next_prefs, 'locale': locale or current['locale'], 'accountNotices': True})


@router.post('/api/internal/telegram/contacts')
async def post_contacts(req: Request):
    rejected = verify_bot(req)
    if rejected is not None: return rejected
    body = await core.payload(req)
    body = body if isinstance(body, dict) else {}
    actor = body.get('telegramUserId')
    if not valid_actor(actor): return core.j({'error': 'invalid_actor'}, 400)
    db = await core.pool()
    async with db.acquire() as conn:
        if type(body.get('blocked')) is bool and body.get('sync') is False:
            await conn.execute('''UPDATE telegram_contacts SET bot_blocked_at=(CASE WHEN $2 THEN NOW() ELSE NULL END),
                                  updated_at=NOW(),last_seen_at=NOW() WHERE telegram_user_id=$1''', actor, body['blocked'])
            return core.j({'ok': True})
        chat_id = clip(body.get('chatId'), 64) or actor
        raw_username = body.get('username')
        username = clip(raw_username[1:] if isinstance(raw_username, str) and raw_username.startswith('@') else raw_username, 120)
        row = await conn.fetchrow('''INSERT INTO telegram_contacts
              (telegram_user_id,chat_id,username,first_name,last_name,language_code,last_seen_at,updated_at)
              VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
              ON CONFLICT (telegram_user_id) DO UPDATE SET
              chat_id=EXCLUDED.chat_id, username=EXCLUDED.username,first_name=EXCLUDED.first_name,
              last_name=EXCLUDED.last_name, language_code=EXCLUDED.language_code,
              last_seen_at=NOW(),updated_at=NOW(),
              removed_at=CASE WHEN $7 THEN NULL ELSE telegram_contacts.removed_at END,
              bot_blocked_at=CASE WHEN $7 THEN NULL ELSE telegram_contacts.bot_blocked_at END
              RETURNING id''', actor, chat_id, username, clip(body.get('firstName'), 120),
              clip(body.get('lastName'), 120), clip(body.get('languageCode'), 10), body.get('restarted') is True)
        if type(body.get('blocked')) is bool:
            await conn.execute('''UPDATE telegram_contacts SET bot_blocked_at=(CASE WHEN $2 THEN NOW() ELSE NULL END),
                             updated_at=NOW(),last_seen_at=NOW() WHERE telegram_user_id=$1''', actor, body['blocked'])
    return core.j({'ok': True, 'contactId': str(row['id']) if row else None})


@router.get('/api/internal/telegram/owner')
async def get_owner(req: Request):
    rejected = verify_bot(req)
    if rejected is not None: return rejected
    actor = req.query_params.get('actorTelegramId', '')
    if not valid_actor(actor): return core.j({'error': 'invalid_actor'}, 400)
    db = await core.pool()
    async with db.acquire() as conn:
        row = await conn.fetchrow("SELECT value FROM telegram_bot_settings WHERE key='primary_owner_telegram_id'")
        value = jsonb(row['value']) if row else None
        stored = value.get('telegramUserId') if isinstance(value, dict) else value if isinstance(value, str) else None
        if isinstance(stored, str): stored = stored.strip()
        if not valid_actor(stored): stored = None
        env_id = os.environ.get('TELEGRAM_OWNER_ID')
        owner_id = stored or (env_id if valid_actor(env_id) else None)
        source = 'database' if stored else 'bootstrap' if owner_id else 'none'
        if not owner_id or owner_id != actor: return core.j({'error': 'forbidden'}, 403)
        linked = await conn.fetchrow('SELECT name FROM users WHERE telegram_id=$1 LIMIT 1', owner_id)
        return core.j({'ok': True, 'telegramUserId': owner_id, 'source': source,
                       'linkedName': linked['name'] if linked else None, 'botfatherDetected': False})


def install(): core.app.include_router(router)
