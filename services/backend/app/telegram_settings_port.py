"""Primary-owner-only Telegram settings, with PostgreSQL current-owner checks.

Ports `required-channels` and the sensitive contact detail endpoint. Delegated bot
admins and website admins do not inherit BOT_SETTINGS permission.
"""
from __future__ import annotations
import json
import os
import re
from fastapi import APIRouter, Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_preferences_port import valid_actor, jsonb

router=APIRouter()
CHANNEL_ID=re.compile(r'^-100[0-9]{5,20}$')
LINK=re.compile(r'^https://t\.me/(?:[a-zA-Z0-9_]{4,}|\+[a-zA-Z0-9_-]+)$')


def decode(value):
    if value is None:return []
    if not isinstance(value,list) or len(value)>4:raise ValueError('required_channels_corrupt')
    used=set(); result=[]
    for entry in value:
        if (not isinstance(entry,dict) or not isinstance(entry.get('id'),str)
            or not CHANNEL_ID.fullmatch(entry['id']) or not isinstance(entry.get('title'),str)
            or not 1<=len(entry['title'])<=120 or not isinstance(entry.get('url'),str)
            or not LINK.fullmatch(entry['url']) or entry['id'] in used):
            raise ValueError('required_channels_corrupt')
        result.append({'id':entry['id'],'title':entry['title'],'url':entry['url']})
        used.add(entry['id'])
    return result


async def bot_owner(conn, actor):
    if not valid_actor(actor):return None,'invalid_actor'
    record=await conn.fetchrow("SELECT value FROM telegram_bot_settings WHERE key='primary_owner_telegram_id'")
    raw=jsonb(record['value']) if record else None
    stored=raw.get('telegramUserId') if isinstance(raw,dict) else raw
    if isinstance(stored,str):stored=stored.strip()
    if not valid_actor(stored):stored=None
    fallback=os.getenv('TELEGRAM_OWNER_ID')
    owner=stored or (fallback.strip() if isinstance(fallback,str) and valid_actor(fallback.strip()) else None)
    if not owner or owner!=actor:return None,'forbidden'
    linked=await conn.fetchrow('SELECT id FROM users WHERE telegram_id=$1 LIMIT 1',actor)
    if linked:audit_id=linked['id']
    else:
        active=await conn.fetchrow("SELECT id FROM users WHERE role='owner' AND account_status='active' LIMIT 1")
        audit_id=active['id'] if active else None
    return audit_id,None


async def list_channels(conn):
    row=await conn.fetchrow("SELECT value FROM telegram_bot_settings WHERE key='required_channels'")
    return decode(jsonb(row['value']) if row else None)


@router.get('/api/internal/telegram/required-channels')
async def get_required_channels(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    actor=req.query_params.get('actorTelegramId')
    db=await core.pool()
    async with db.acquire() as conn:
        _audit, error=await bot_owner(conn,actor)
        if error:return core.j({'error':error},400 if error=='invalid_actor' else 403)
        channels=await list_channels(conn)
    return core.j({'channels':channels})


@router.post('/api/internal/telegram/required-channels')
async def post_required_channels(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    body=await core.payload(req)
    body=body if isinstance(body,dict) else {}
    actor=body.get('actorTelegramId')
    db=await core.pool()
    async with db.acquire() as conn:
        audit_id,error=await bot_owner(conn,actor)
        if error:return core.j({'error':error},400 if error=='invalid_actor' else 403)
        action=body.get('action'); c=body.get('channel')
        if (action not in ('add','remove') or not isinstance(c,dict)
                or not isinstance(c.get('id'),str)):
            return core.j({'error':'invalid_input'},400)
        if action=='add' and (not isinstance(c.get('title'),str) or not isinstance(c.get('url'),str)):
            return core.j({'error':'invalid_input'},400)
        if not CHANNEL_ID.fullmatch(c['id']):return core.j({'error':'invalid_channel'},400)
        if action=='add' and (not 1<=len(c['title'])<=120 or not LINK.fullmatch(c['url'])):
            return core.j({'error':'invalid_channel'},400)
        # The transaction-level lock and current read keep additions below 4.
        async with conn.transaction():
            await conn.execute('select pg_advisory_xact_lock(719335, 103)')
            channels=await list_channels(conn)
            if action=='add' and any(x['id']==c['id'] for x in channels):
                next_channels=channels
            elif action=='add':
                if len(channels)>=4:return core.j({'error':'max_channels'},409)
                next_channels=[*channels,{'id':c['id'],'title':c['title'],'url':c['url']}]
            else:
                next_channels=[x for x in channels if x['id']!=c['id']]
            # Original inserts/updates even when an addition is a duplicate.
            await conn.execute('''INSERT INTO telegram_bot_settings (key,value,updated_by_telegram_id,updated_at)
                VALUES('required_channels',$1::jsonb,$2,NOW())
                ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,
                updated_by_telegram_id=EXCLUDED.updated_by_telegram_id,updated_at=EXCLUDED.updated_at''',json.dumps(next_channels),actor)
        await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
                VALUES($1,'bot_settings.changed','telegram_bot_setting','required_channels',$2::jsonb)''',
                audit_id,json.dumps({'actorTelegramId':actor,'action':action,'channelId':c['id']}))
    return core.j({'success':True,'channels':next_channels})


@router.get('/api/internal/telegram/contacts/{telegramUserId}')
async def get_telegram_contact(req:Request,telegramUserId:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    actor=req.query_params.get('actorTelegramId')
    db=await core.pool()
    async with db.acquire() as conn:
        _,error=await bot_owner(conn,actor)
        if error:return core.j({'error':error},400 if error=='invalid_actor' else 403)
        if not valid_actor(telegramUserId):return core.j({'error':'not_found'},404)
        row=await conn.fetchrow('''SELECT telegram_user_id,username,phone_number,phone_verified_at
                                   FROM telegram_contacts WHERE telegram_user_id=$1''',telegramUserId)
    if not row:return core.j({'error':'not_found'},404)
    verified=bool(row['phone_verified_at'])
    return core.j({'telegramUserId':row['telegram_user_id'],'username':row['username'],
                   'phoneNumber':row['phone_number'] if verified else None,'phoneVerified':verified})


def install():core.app.include_router(router)
