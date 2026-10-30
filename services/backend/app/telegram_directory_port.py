"""Telegram website-user directory and guarded account maintenance API.
Source: src/lib/telegram/{directory,messages,identity,contacts}.ts.
"""
from __future__ import annotations
import math
from datetime import datetime, timezone
from fastapi import APIRouter,Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_admins_port import actor_for,denied_response,audit,effective_owner_id
from .telegram_preferences_port import clip
from .db import row_to_dict
router=APIRouter()


def jsiso(date):
    return date.isoformat(timespec='milliseconds').replace('+00:00','Z') if date else None


def uuid_ok(id):return core.uuid_value(id) is not None


def sql_like(s):
    return '%'+s.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'


async def guard(req,conn,actor_id,permission,audit_required=False):
    err=verify_bot(req)
    if err is not None:return None,err
    actor,error=await actor_for(conn,actor_id,permission,audit_required)
    return (actor,None) if not error else (None,denied_response(error))


async def target(conn,user_id):
    user=await conn.fetchrow('SELECT id,telegram_id,role,account_status FROM users WHERE id=$1 LIMIT 1',user_id)
    if not user:return None,'not_found'
    if user['telegram_id'] and user['telegram_id']==await effective_owner_id(conn):return None,'primary_owner_protected'
    return user,None


@router.get('/api/internal/telegram/directory')
async def search_directory(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,req.query_params.get('actorTelegramId'),'VIEW_USERS')
        if error:return denied_response(error)
        try:
            page=float(req.query_params.get('page') or '1')
            page=max(1,page if page else 1)
        except ValueError:page=1
        # Original Drizzle LIMIT/OFFSET requires an integer. A fractional page is
        # rarely supplied; prefer the equivalent floor as used by the DB driver.
        if not math.isfinite(page):page=1
        page=int(page)
        limit=page*10;offset=(page-1)*10
        q=(req.query_params.get('q') or '').strip()
        t=q.lstrip('@')
        status=req.query_params.get('status');role=req.query_params.get('role')
        where=[];args=[]
        if status in ('pending','active','rejected','suspended'):
            args.append(status);where.append(f'u.account_status=${len(args)}')
        if role in ('student','teacher','admin','owner'):
            args.append(role);where.append(f'u.role=${len(args)}')
        if q:
            args.extend((sql_like(q[:80]),t,sql_like(t[:80])))
            a,b,c=range(len(args)-2,len(args)+1)
            where.append(f'''(u.name ILIKE ${a} OR u.email ILIKE ${a} OR u.telegram_id=${b}
             OR EXISTS (SELECT 1 FROM telegram_contacts tc WHERE tc.linked_user_id=u.id AND tc.username ILIKE ${c}))''')
        filter_sql=' AND '.join(where) or 'TRUE'
        users=await conn.fetch(f'''SELECT u.id,u.name,u.email,u.role,u.account_status,u.telegram_id,u.created_at
          FROM users u WHERE {filter_sql} ORDER BY u.created_at DESC LIMIT {limit}''',*args)
        count=await conn.fetchval(f'SELECT count(*)::int FROM users u WHERE {filter_sql}',*args)
        contacts=[];contacts_count=0
        # Intentional: any role/status string excludes Telegram-only contacts,
        # even unrecognised filters, matching the source.
        if not status and not role:
            params=[sql_like(q[:80]),sql_like(t[:80]),t] if q else []
            extras=('AND (first_name ILIKE $1 OR last_name ILIKE $1 OR username ILIKE $2 OR telegram_user_id=$3)' if q else '')
            contacts=await conn.fetch(f'''SELECT id,telegram_user_id,username,first_name,last_name,
                bot_blocked_at,removed_at,last_seen_at FROM telegram_contacts
                WHERE linked_user_id IS NULL {extras} ORDER BY last_seen_at DESC LIMIT {limit}''',*params)
            contacts_count=await conn.fetchval(f'''SELECT count(*)::int FROM telegram_contacts
                WHERE linked_user_id IS NULL {extras}''',*params)
        items=[]
        for r in users:
            data=row_to_dict(r)
            items.append({'id':data['id'],'name':r['name'],'email':r['email'],'role':r['role'],
              'accountStatus':r['account_status'],'telegramId':r['telegram_id'],
              'createdAt':jsiso(r['created_at']),'entryType':'website_user','telegramLinked':bool(r['telegram_id'])})
        for r in contacts:
            name=(' '.join((r['first_name'] or '',r['last_name'] or ''))).strip() or ('@'+r['username'] if r['username'] else r['telegram_user_id'])
            items.append({'id':str(r['id']),'entryType':'telegram_contact','telegramUserId':r['telegram_user_id'],
              'username':r['username'],'name':name,'email':None,'role':None,'accountStatus':None,
              'telegramLinked':True,'botBlocked':bool(r['bot_blocked_at']), 'botRemoved':bool(r['removed_at']),
              'createdAt':jsiso(r['last_seen_at'])})
        # Original lists are individually capped at page*10 and merged by date.
        items.sort(key=lambda e:e['createdAt'] or '',reverse=True)
        return core.j({'items':items[offset:offset+10],'page':page,'pageSize':10,'total':int(count or 0)+int(contacts_count or 0)})


@router.get('/api/internal/telegram/directory/{userId}')
async def directory_detail(req:Request,userId:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not uuid_ok(userId):return core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,req.query_params.get('actorTelegramId'),'VIEW_USERS')
        if error:return denied_response(error)
        user=await conn.fetchrow('''SELECT id,name,email,role,account_status,status_reason,locale,telegram_id,
                created_at,last_active_at FROM users WHERE id=$1''',userId)
        if not user:return core.j({'error':'not_found'},404)
        contact=await conn.fetchrow('''SELECT username,bot_blocked_at,removed_at,chat_id FROM telegram_contacts
          WHERE telegram_user_id=$1 LIMIT 1''',user['telegram_id']) if user['telegram_id'] else await conn.fetchrow('''SELECT username,bot_blocked_at,removed_at,chat_id FROM telegram_contacts WHERE linked_user_id=$1 LIMIT 1''',userId)
        audits=await conn.fetch('''SELECT action,created_at,metadata FROM audit_log WHERE target_id=$1 ORDER BY created_at DESC LIMIT 8''',userId)
        return core.j({'user':{'id':str(user['id']),'name':user['name'],'email':user['email'],
          'role':user['role'],'accountStatus':user['account_status'],'statusReason':user['status_reason'],
          'locale':user['locale'],'telegramId':user['telegram_id'],'createdAt':jsiso(user['created_at']),
          'lastActiveAt':jsiso(user['last_active_at']),'telegramLinked':bool(user['telegram_id']),
          'primaryOwner':bool(user['telegram_id'] and user['telegram_id']==await effective_owner_id(conn))},
          'contact':({'username':contact['username'],'blocked':bool(contact['bot_blocked_at']),
           'removed':bool(contact['removed_at']),'chatId':contact['chat_id']} if contact else None),
          'audit':[{'action':r['action'],'createdAt':jsiso(r['created_at']),'metadata':r['metadata']} for r in audits]})


@router.post('/api/internal/telegram/directory/{userId}/unlink')
async def directory_unlink(req:Request,userId:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not uuid_ok(userId):return core.j({'error':'not_found'},404)
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'MANAGE_USERS')
        if error:return denied_response(error)
        user,error=await target(conn,userId)
        if error:return core.j({'error':error},404 if error=='not_found' else 409)
        old=user['telegram_id']
        if not old:return core.j({'ok':True,'already':True})
        await conn.execute('UPDATE users SET telegram_id=NULL WHERE id=$1',userId)
        await conn.execute('''UPDATE telegram_contacts SET linked_user_id=NULL,updated_at=NOW()
                 WHERE telegram_user_id=$1''',old)
        await audit(conn,actor,'telegram.unlinked','user',userId,{'previousTelegramUserId':old,'correlationId':None})
        return core.j({'ok':True,'already':False})


@router.post('/api/internal/telegram/directory/{userId}/remove')
async def directory_remove(req:Request,userId:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not uuid_ok(userId):return core.j({'error':'not_found'},404)
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'MANAGE_USERS')
        if error:return denied_response(error)
        user,error=await target(conn,userId)
        if error:return core.j({'error':error},404 if error=='not_found' else 409)
        tg=user['telegram_id']
        if not tg:
            row=await conn.fetchrow('SELECT telegram_user_id FROM telegram_contacts WHERE linked_user_id=$1 LIMIT 1',userId)
            if not row:return core.j({'ok':True,'already':True})
            tg=row['telegram_user_id']
        await conn.execute('''UPDATE telegram_contacts SET removed_at=NOW(),phone_number=NULL,
                phone_verified_at=NULL,updated_at=NOW() WHERE telegram_user_id=$1''',tg)
        await audit(conn,actor,'telegram.bot_contact_removed','user',userId)
        return core.j({'ok':True,'already':False})


@router.post('/api/internal/telegram/directory/{userId}/message')
async def directory_message(req:Request,userId:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not uuid_ok(userId):return core.j({'error':'not_found'},404)
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        if body.get('report') is True:
            message_id=body.get('messageId');status=body.get('status')
            if not uuid_ok(message_id) or status not in ('sent','failed','blocked'):
                return core.j({'error':'invalid_input'},400)
            row=await conn.fetchrow('''UPDATE telegram_direct_messages SET status=$2,error_message=$3,
             telegram_message_id=$4,sent_at=CASE WHEN $5 THEN NOW() ELSE NULL END
             WHERE id=$1 RETURNING id,status''',message_id,status,
             (body.get('error')[:300] if isinstance(body.get('error'),str) else None),
             body.get('telegramMessageId') if isinstance(body.get('telegramMessageId'),str) else None,status=='sent')
            return core.j({'ok':True,'status':row['status']}) if row else core.j({'error':'not_found'},404)
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'DIRECT_MESSAGE')
        if error:return denied_response(error)
        message=clip(body.get('text'),4000) or ''
        if not message:return core.j({'ok':False,'error':'invalid_input'},400)
        user=await conn.fetchrow('SELECT id,name,telegram_id FROM users WHERE id=$1 LIMIT 1',userId)
        if not user:return core.j({'ok':False,'error':'not_found'},404)
        if not user['telegram_id']:return core.j({'ok':False,'error':'unavailable','reason':'never_started'},409)
        contact=await conn.fetchrow('''SELECT chat_id,bot_blocked_at,removed_at FROM telegram_contacts
             WHERE telegram_user_id=$1 LIMIT 1''',user['telegram_id'])
        if not contact:return core.j({'ok':False,'error':'unavailable','reason':'never_started'},409)
        if contact['bot_blocked_at']:return core.j({'ok':False,'error':'blocked','reason':'blocked'},409)
        if contact['removed_at']:return core.j({'ok':False,'error':'blocked','reason':'removed'},409)
        row=await conn.fetchrow('''INSERT INTO telegram_direct_messages
          (actor_telegram_id,actor_user_id,target_user_id,target_telegram_id,body,status)
          VALUES($1,$2,$3,$4,$5,'queued') RETURNING id''',actor['telegramUserId'],actor['auditUserId'],
          userId,user['telegram_id'],message)
        return core.j({'ok':True,'messageId':str(row['id']) if row else None,'chatId':contact['chat_id'],
          'targetName':user['name'],'targetTelegramId':user['telegram_id'],'text':message,'status':'queued'})


@router.post('/api/internal/telegram/directory/{userId}/status')
async def directory_status(req:Request,userId:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not uuid_ok(userId):return core.j({'error':'not_found'},404)
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'MANAGE_USERS',True)
        if error:return denied_response(error)
        status=body.get('status')
        if status not in ('suspended','active'):return core.j({'error':'invalid_input'},400)
        user,error=await target(conn,userId)
        if error:return core.j({'error':error},404 if error=='not_found' else 409)
        if status=='suspended' and user['role']=='owner' and user['account_status']=='active':
            other=await conn.fetchval('''SELECT count(*)::int FROM users WHERE role='owner' AND
                         account_status='active' AND id<>$1''',userId)
            if not other:return core.j({'error':'last_owner'},409)
        if status=='active' and user['account_status']!='suspended':return core.j({'error':'not_suspended'},409)
        reason=clip(body.get('reason'),500)
        await conn.execute('''UPDATE users SET account_status=$2,status_updated_at=NOW(),status_reason=$3
                          WHERE id=$1''',userId,status,reason)
        await conn.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata)
              VALUES($1,$2,'user',$3,$4::jsonb)''',actor['auditUserId'],
              'account.suspended' if status=='suspended' else 'account.reactivated',userId,
              __import__('json').dumps({'status':status}))
        await conn.execute('''INSERT INTO notifications(user_id,type,title,body,href)
              VALUES($1,$2,$3,$4,$5)''',userId,'ACCOUNT_SUSPENDED' if status=='suspended' else 'ACCOUNT_UPDATED',
              'Account suspended' if status=='suspended' else 'Account '+status,reason,
              '/app' if status=='active' else '/pending')
        return core.j({'ok':True,'status':status})


def install():core.app.include_router(router)
