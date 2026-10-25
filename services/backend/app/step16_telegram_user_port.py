"""Bot-authenticated Telegram user read, matching src/app/api/internal/telegram/users/[telegramUserId]."""
from __future__ import annotations
from fastapi import APIRouter, Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_preferences_port import valid_actor,jsonb
from .telegram_admins_port import effective_owner_id,grantable,PERMISSIONS
router=APIRouter()

@router.get('/api/internal/telegram/users/{telegramUserId}')
async def telegram_user(req:Request,telegramUserId:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not valid_actor(telegramUserId):return core.j({'error':'invalid_actor'},400)
    try:
        db=await core.pool()
        async with db.acquire() as con:
            user=await con.fetchrow('''SELECT id,role,name,account_status,locale,email
                FROM users WHERE telegram_id=$1 LIMIT 1''',telegramUserId)
            admin=await con.fetchrow('''SELECT permissions,linked_user_id FROM telegram_bot_admins
                 WHERE telegram_user_id=$1 AND is_active=true AND deactivated_at IS NULL LIMIT 1''',telegramUserId)
            contact=await con.fetchrow('''SELECT chat_id,username,first_name,last_name,language_code,
              locale_override,bot_blocked_at,removed_at FROM telegram_contacts
              WHERE telegram_user_id=$1 LIMIT 1''',telegramUserId)
            owner=telegramUserId==await effective_owner_id(con)
        access={'isPrimaryOwner':bool(owner), 'permissions':list(PERMISSIONS) if owner else grantable(jsonb(admin['permissions'])) if admin else [],
                'active': bool(owner or admin)}
        return core.j({'found':bool(user),'user':{'id':str(user['id']),'role':user['role'],
          'name':user['name'],'accountStatus':user['account_status'],'locale':user['locale'],'email':user['email']}
          if user else None,'botAccess':access,'contact':{
          'chatId':contact['chat_id'],'username':contact['username'],'firstName':contact['first_name'],
          'lastName':contact['last_name'],'languageCode':contact['language_code'],
          'localeOverride':contact['locale_override'],'blocked':contact['bot_blocked_at'] is not None,
          'removed':contact['removed_at'] is not None} if contact else None})
    except Exception:
        return core.j({'error':'internal_error'},500)

def install():core.app.include_router(router)
