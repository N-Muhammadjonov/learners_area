"""Translation of Telegram bot-admin actor and management from src/lib/telegram/{actor,admins}.ts.
Bot bearer authentication is mandatory and website roles never grant bot powers.
"""
from __future__ import annotations
import os, json
from datetime import datetime, timezone
from fastapi import APIRouter, Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_preferences_port import valid_actor, jsonb
from .telegram_settings_port import bot_owner

router = APIRouter()
PERMISSIONS = ('VIEW_USERS','MANAGE_USERS','ADMISSIONS','SUPPORT','DIRECT_MESSAGE','BROADCAST','VIEW_STATS','VIEW_AUDIT')
OWNER_ONLY = ('MANAGE_BOT_ADMINS','DANGEROUS_USER_DELETE','BOT_SETTINGS')


def grantable(value):
    if not isinstance(value, list): return []
    return list(dict.fromkeys(x for x in value if isinstance(x, str) and x in PERMISSIONS))


async def actor_for(conn, telegram_id, permission, audit_required=False):
    if not valid_actor(telegram_id): return None,'invalid_actor'
    owner_audit,denied = await bot_owner(conn, telegram_id)
    linked = await conn.fetchrow('''SELECT id,role,account_status FROM users WHERE telegram_id=$1 LIMIT 1''',telegram_id)
    if not denied:
        audit = linked['id'] if linked else owner_audit
        if audit_required and not audit:return None,'actor_not_linked'
        return {'telegramUserId':telegram_id,'auditUserId':audit,'linkedUserId':linked['id'] if linked else None,'isPrimaryOwner':True},None
    if permission in OWNER_ONLY:return None,'forbidden'
    row = await conn.fetchrow('''SELECT permissions, linked_user_id FROM telegram_bot_admins
            WHERE telegram_user_id=$1 AND is_active=true AND deactivated_at IS NULL LIMIT 1''',telegram_id)
    if not row or permission not in grantable(jsonb(row['permissions'])):return None,'forbidden'
    audit = row['linked_user_id'] or (linked['id'] if linked else None)
    if audit_required and not audit:return None,'actor_not_linked'
    return {'telegramUserId':telegram_id,'auditUserId':audit,'linkedUserId':audit,'isPrimaryOwner':False},None


def denied_response(error):
    return core.j({'error':error},400 if error=='invalid_actor' else 409 if error=='actor_not_linked' else 403)


async def audit(conn, actor, action, target_type, target_id, metadata=None):
    await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
      VALUES($1,$2,$3,$4,$5::jsonb)''',actor['auditUserId'],action,target_type,str(target_id),json.dumps({
        'source':'telegram_bot','actorTelegramId':actor['telegramUserId'],**(metadata or {})}))


async def effective_owner_id(conn):
    row=await conn.fetchrow("SELECT value FROM telegram_bot_settings WHERE key='primary_owner_telegram_id'")
    stored=jsonb(row['value']) if row else None
    if isinstance(stored,dict):stored=stored.get('telegramUserId')
    if isinstance(stored,str):stored=stored.strip()
    if valid_actor(stored):return stored
    fallback=os.getenv('TELEGRAM_OWNER_ID')
    if isinstance(fallback,str):fallback=fallback.strip()
    return fallback if valid_actor(fallback) else None


async def require(req, conn, actor_id, permission, audit_required=False):
    bot_error=verify_bot(req)
    if bot_error is not None:return None,bot_error
    actor,error=await actor_for(conn, actor_id, permission, audit_required)
    return actor, denied_response(error) if error else None


@router.get('/api/internal/telegram/admins')
async def list_admins(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,req.query_params.get('actorTelegramId'),'MANAGE_BOT_ADMINS')
        if error:return denied_response(error)
        rows=await conn.fetch('''SELECT telegram_user_id,linked_user_id,permissions,is_active,deactivated_at,
                               created_at,updated_at FROM telegram_bot_admins ORDER BY created_at ASC''')
        return core.j({'admins':[{
          'telegramUserId':r['telegram_user_id'],'linkedUserId':str(r['linked_user_id']) if r['linked_user_id'] else None,
          'permissions':grantable(jsonb(r['permissions'])),'isActive':bool(r['is_active'] and not r['deactivated_at']),
          'createdAt':r['created_at'].isoformat(timespec='milliseconds').replace('+00:00','Z'),
          'updatedAt':r['updated_at'].isoformat(timespec='milliseconds').replace('+00:00','Z'),
        } for r in rows]})


@router.post('/api/internal/telegram/admins')
async def add_admin(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'MANAGE_BOT_ADMINS')
        if error:return denied_response(error)
        tg=body.get('telegramUserId') if isinstance(body.get('telegramUserId'),str) else ''
        if not valid_actor(tg):return core.j({'error':'invalid_actor'},409)
        if tg==await effective_owner_id(conn):return core.j({'error':'primary_owner_protected'},409)
        permissions=grantable(body.get('permissions'))
        linked=await conn.fetchval('SELECT id FROM users WHERE telegram_id=$1 LIMIT 1',tg)
        await conn.execute('''INSERT INTO telegram_bot_admins(telegram_user_id,linked_user_id,permissions,is_active,created_by,updated_at)
          VALUES($1,$2,$3::jsonb,true,$4,NOW())
          ON CONFLICT(telegram_user_id) DO UPDATE SET permissions=EXCLUDED.permissions,is_active=true,
          deactivated_at=NULL,linked_user_id=EXCLUDED.linked_user_id,updated_at=NOW()''',tg,linked,json.dumps(permissions),actor['auditUserId'])
        await audit(conn,actor,'bot_admin.added','telegram_bot_admin',tg,{'permissions':permissions})
    return core.j({'ok':True,'permissions':permissions})


async def update(conn,actor,tg,body):
    if not valid_actor(tg):return core.j({'error':'invalid_actor'},409)
    if tg==await effective_owner_id(conn):return core.j({'error':'primary_owner_protected'},409)
    existing=await conn.fetchrow('''SELECT id,permissions,is_active FROM telegram_bot_admins WHERE telegram_user_id=$1 LIMIT 1''',tg)
    if not existing:return core.j({'error':'not_found'},404)
    before=grantable(jsonb(existing['permissions']))
    permissions=grantable(body['permissions']) if 'permissions' in body else before
    active=body.get('active') if type(body.get('active')) is bool else bool(existing['is_active'])
    await conn.execute('''UPDATE telegram_bot_admins SET permissions=$2::jsonb,is_active=$3,
       deactivated_at=CASE WHEN $3 THEN NULL ELSE NOW() END,updated_at=NOW() WHERE id=$1''',existing['id'],json.dumps(permissions),active)
    action=('bot_admin.added' if active else 'bot_admin.removed') if sorted(before)==sorted(permissions) else 'bot_admin.permissions_changed'
    await audit(conn,actor,action,'telegram_bot_admin',tg,{'permissions':permissions,'active':active})
    return core.j({'ok':True,'permissions':permissions,'active':active})


@router.patch('/api/internal/telegram/admins/{telegramUserId}')
async def patch_admin(req:Request,telegramUserId:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'MANAGE_BOT_ADMINS')
        if error:return denied_response(error)
        return await update(conn,actor,telegramUserId,body)


@router.delete('/api/internal/telegram/admins/{telegramUserId}')
async def delete_admin(req:Request,telegramUserId:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,req.query_params.get('actorTelegramId'),'MANAGE_BOT_ADMINS')
        if error:return denied_response(error)
        return await update(conn,actor,telegramUserId,{'active':False})


def install():core.app.include_router(router)
