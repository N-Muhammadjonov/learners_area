"""Telegram bot operations (stats/audit/settings, and whitelisted settings edits)."""
from __future__ import annotations
import json
from fastapi import APIRouter,Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_settings_port import bot_owner
from .telegram_preferences_port import valid_actor, jsonb

router=APIRouter()
ALLOW_PERMS={'VIEW_STATS','VIEW_AUDIT'}

async def actor_guard(conn, actor, permission):
    if not valid_actor(actor):return None,'invalid_actor'
    audit_id,error=await bot_owner(conn,actor)
    if not error:return audit_id,None
    if permission=='BOT_SETTINGS':return None,'forbidden'
    admin=await conn.fetchrow('''SELECT permissions, linked_user_id FROM telegram_bot_admins
          WHERE telegram_user_id=$1 AND is_active=TRUE AND deactivated_at IS NULL LIMIT 1''',actor)
    if not admin or permission not in (jsonb(admin['permissions']) or []):return None,'forbidden'
    return admin['linked_user_id'],None

@router.get('/api/internal/telegram/ops')
async def get_ops(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    view=req.query_params.get('view')
    permission='VIEW_AUDIT' if view=='audit' else 'BOT_SETTINGS' if view=='settings' else 'VIEW_STATS'
    actor=req.query_params.get('actorTelegramId')
    db=await core.pool()
    async with db.acquire() as conn:
        audit_id,error=await actor_guard(conn,actor,permission)
        if error:return core.j({'error':error},400 if error=='invalid_actor' else 403)
        if view=='settings':
            rows=await conn.fetch('SELECT key,value FROM telegram_bot_settings')
            values={r['key']:jsonb(r['value']) for r in rows}
            return core.j({'default_locale':'en' if values.get('default_locale')=='en' else 'uz',
                           'support_enabled':values.get('support_enabled') is not False,
                           'broadcasts_enabled':values.get('broadcasts_enabled') is not False})
        if view=='audit':
            param=req.query_params.get('page')
            try:page=float(param) if param is not None else 1.0
            except (ValueError,TypeError):page=1.0
            if page!=page or page in (float('inf'),float('-inf')):page=1
            # JS: Number('') === 0; || 1 within botAudit(), safePage clamp.
            safe_page=max(int(page) if page else 1,1)
            rows=await conn.fetch('''SELECT action,target_type,target_id,created_at,metadata
               FROM audit_log ORDER BY created_at DESC LIMIT 8 OFFSET $1''',8*(safe_page-1))
            items=[{'action':r['action'],'targetType':r['target_type'],'targetId':r['target_id'],
                    'createdAt':r['created_at'].isoformat(timespec='milliseconds').replace('+00:00','Z'),
                    'metadata':r['metadata']} for r in rows]
            return core.j({'entries':items,'page':page})
        accounts=await conn.fetchrow('''SELECT count(*) FILTER(WHERE account_status='pending')::int AS pending,
          count(*) FILTER(WHERE account_status='active')::int AS active,
          count(*) FILTER(WHERE account_status='rejected')::int AS rejected,
          count(*) FILTER(WHERE account_status='suspended')::int AS suspended FROM users''')
        contacts=await conn.fetchrow('''SELECT count(*)::int AS contacts,
          count(*) FILTER(WHERE bot_blocked_at IS NOT NULL)::int AS blocked,
          count(*) FILTER(WHERE removed_at IS NOT NULL)::int AS removed FROM telegram_contacts''')
        support=await conn.fetchrow("SELECT count(*) FILTER(WHERE status <> 'closed')::int AS open FROM telegram_support_threads")
        return core.j({'accounts':dict(accounts),'contacts':dict(contacts),'support':dict(support)})

@router.patch('/api/internal/telegram/ops')
async def patch_ops(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    body=await core.payload(req)
    body=body if isinstance(body,dict) else {}
    actor=body.get('actorTelegramId')
    db=await core.pool()
    async with db.acquire() as conn:
        audit_id,error=await actor_guard(conn,actor,'BOT_SETTINGS')
        if error:return core.j({'error':error},400 if error=='invalid_actor' else 403)
        key=body.get('key');val=body.get('value')
        if (not isinstance(key,str) or key not in ('default_locale','support_enabled','broadcasts_enabled')
            or (key=='default_locale' and val not in ('uz','en'))
            or (key!='default_locale' and type(val) is not bool)):
            return core.j({'error':'invalid_setting'},400)
        await conn.execute('''INSERT INTO telegram_bot_settings(key,value,updated_at,updated_by_telegram_id)
             VALUES($1,$2::jsonb,NOW(),$3)
             ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,
             updated_at=EXCLUDED.updated_at,updated_by_telegram_id=EXCLUDED.updated_by_telegram_id''',key,json.dumps(val),actor)
        await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
             VALUES($1,'bot_settings.changed','telegram_bot_setting',$2,$3::jsonb)''',audit_id,key,
             json.dumps({'source':'telegram_bot','actorTelegramId':actor,'value':val}))
        return core.j({'ok':True,'key':key,'value':val})

def install():core.app.include_router(router)
