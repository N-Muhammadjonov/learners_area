"""Telegram support thread, message, workflow and flow-draft APIs.
Port of src/lib/telegram/{support,flow-drafts}.ts and corresponding route.ts.
All user/admin views preserve the original authorization separation.
"""
from __future__ import annotations
import json, math
from fastapi import APIRouter,Request
from . import main as core
from .internal_bot_ready_port import verify_bot
from .telegram_admins_port import actor_for,denied_response,audit,effective_owner_id,grantable
from .telegram_preferences_port import valid_actor,clip,jsonb
from .rate_limit import RULES,async_counter as counter,too_many
router=APIRouter()
RULES.setdefault('telegram_support',(40,900))
OPEN=('open','waiting_for_user','waiting_for_staff')
MESSAGE_TYPES=('text','photo','document','voice','audio')
DRAFT_KINDS=('dm','broadcast','search','admin','support_reply')


def iso(value):return value.isoformat(timespec='milliseconds').replace('+00:00','Z') if value else None


def body_obj(body):return body if isinstance(body,dict) else {}


def message_fields(body):
    msg_type=body.get('messageType') if body.get('messageType') in MESSAGE_TYPES else 'text'
    text=clip(body.get('text'),4000)
    file_id=clip(body.get('fileId'),300)
    return msg_type,text,file_id,clip(body.get('fileName'),255),clip(body.get('mimeType'),120)


async def staff(req,conn,id):
    error=verify_bot(req)
    if error is not None:return None,error
    actor,err=await actor_for(conn,id,'SUPPORT')
    return (actor,None) if not err else (None,denied_response(err))


@router.get('/api/internal/telegram/support/threads')
async def support_list(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,req.query_params.get('actorTelegramId'),'SUPPORT')
        if error:return denied_response(error)
        view=req.query_params.get('filter');view=view if view in ('mine','all','closed') else 'open'
        page=req.query_params.get('page')
        try:page=int(max(1,float(page or '1')))
        except (ValueError,OverflowError):page=1
        where= ('t.status=\'closed\'' if view=='closed' else
                "t.status IN ('open','waiting_for_user','waiting_for_staff')" if view=='open' else
                't.assigned_telegram_id=$1' if view=='mine' else 'TRUE')
        args=[actor['telegramUserId']] if view=='mine' else []
        entries=await conn.fetch(f'''SELECT t.id,t.telegram_user_id,t.status,t.assigned_telegram_id,
         t.created_at,t.updated_at,t.last_message_at,u.name,u.account_status
         FROM telegram_support_threads t LEFT JOIN users u ON u.telegram_id=t.telegram_user_id
         WHERE {where} ORDER BY t.updated_at DESC LIMIT 10 OFFSET {10*(page-1)}''',*args)
        count=await conn.fetchval(f'SELECT count(*)::int FROM telegram_support_threads t WHERE {where}',*args)
        items=[{'id':str(r['id']),'telegramUserId':r['telegram_user_id'],'status':r['status'],
                'assignedTelegramId':r['assigned_telegram_id'],'createdAt':iso(r['created_at']),
                'updatedAt':iso(r['updated_at']),'lastMessageAt':iso(r['last_message_at']),
                'name':r['name'],'accountStatus':r['account_status']} for r in entries]
        return core.j({'items':items,'page':page,'pageSize':10,'total':int(count or 0)})


@router.post('/api/internal/telegram/support/threads')
async def support_create(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    body=body_obj(await core.payload(req));tg=body.get('telegramUserId') if isinstance(body.get('telegramUserId'),str) else ''
    if not valid_actor(tg):return core.j({'error':'invalid_actor'},400)
    delay=await counter('telegram_support','support:'+tg,consume=True)
    if delay:return too_many(delay)
    db=await core.pool()
    async with db.acquire() as conn:
        setting=await conn.fetchrow("SELECT value FROM telegram_bot_settings WHERE key='support_enabled'")
        if setting and jsonb(setting['value']) is False:return core.j({'error':'support_disabled'},403)
        typ,text,file_id,file_name,mime=message_fields(body)
        if (typ=='text' and not text) or (typ!='text' and not file_id):return core.j({'error':'invalid_input'},400)
        contact=await conn.fetchrow('''SELECT first_name,bot_blocked_at FROM telegram_contacts
           WHERE telegram_user_id=$1''',tg)
        if contact and contact['bot_blocked_at']:return core.j({'error':'blocked'},409)
        linked=await conn.fetchrow('SELECT id,name,account_status FROM users WHERE telegram_id=$1 LIMIT 1',tg)
        existing=await conn.fetchrow('''SELECT id,assigned_telegram_id,linked_user_id FROM telegram_support_threads
           WHERE telegram_user_id=$1 AND status IN ('open','waiting_for_user','waiting_for_staff')
           ORDER BY updated_at DESC LIMIT 1''',tg)
        if existing:
            thread_id=existing['id'];assignee=existing['assigned_telegram_id'];old_link=existing['linked_user_id']
        else:
            created=await conn.fetchrow('''INSERT INTO telegram_support_threads
             (telegram_user_id,linked_user_id,status,last_message_at,updated_at)
             VALUES($1,$2,'waiting_for_staff',NOW(),NOW()) RETURNING id''',tg,linked['id'] if linked else None)
            if not created:return core.j({'error':'internal_error'},400)
            thread_id=created['id'];assignee=None;old_link=None
        msg=await conn.fetchrow('''INSERT INTO telegram_support_messages(thread_id,sender_type,sender_user_id,
           sender_telegram_id,message_type,text,telegram_file_id,file_name,mime_type)
           VALUES($1,'user',$2,$3,$4,$5,$6,$7,$8) RETURNING id''',thread_id,
           linked['id'] if linked else None,tg,typ,text,file_id,file_name,mime)
        await conn.execute('''UPDATE telegram_support_threads SET status='waiting_for_staff',
           last_message_at=NOW(),updated_at=NOW(),linked_user_id=$2 WHERE id=$1''',
           thread_id,linked['id'] if linked else old_link)
        recipients={}
        owner=await effective_owner_id(conn)
        if owner:recipients[owner]=None
        if assignee:recipients[assignee]=None
        admins=await conn.fetch('SELECT telegram_user_id,permissions FROM telegram_bot_admins WHERE is_active=true')
        for r in admins:
            if 'SUPPORT' in grantable(jsonb(r['permissions'])):recipients[r['telegram_user_id']]=None
        return core.j({'ok':True,'threadId':str(thread_id),'messageId':str(msg['id']) if msg else None,
          'status':'waiting_for_staff','notifyTelegramIds':list(recipients),
          'preview':{'name':linked['name'] if linked else (contact['first_name'] if contact else None) or tg,
           'accountStatus':linked['account_status'] if linked else None,'text':text,'messageType':typ}})


@router.get('/api/internal/telegram/support/threads/{id}')
async def support_detail(req:Request,id:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    actor_id=req.query_params.get('actorTelegramId') or ''
    if not valid_actor(actor_id):return core.j({'error':'invalid_actor'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,actor_id,'SUPPORT')
        staff_ok=error is None
        row=await conn.fetchrow('''SELECT id,telegram_user_id,status,assigned_telegram_id,
             created_at,updated_at,closed_at FROM telegram_support_threads WHERE id=$1''',id)
        if not row:return core.j({'error':'not_found'},404)
        if row['telegram_user_id']!=actor_id and not staff_ok:return core.j({'error':'forbidden'},403)
        user=await conn.fetchrow('''SELECT id,name,email,account_status,role FROM users
                 WHERE telegram_id=$1 LIMIT 1''',row['telegram_user_id'])
        contact=await conn.fetchrow('''SELECT username,bot_blocked_at,removed_at FROM telegram_contacts
                 WHERE telegram_user_id=$1 LIMIT 1''',row['telegram_user_id'])
        messages=await conn.fetch('''SELECT id,sender_type,sender_telegram_id,message_type,text,file_name,
             delivery_status,created_at FROM telegram_support_messages WHERE thread_id=$1
             ORDER BY created_at ASC LIMIT 50''',id)
        return core.j({'forbidden':False,'thread':{'id':str(row['id']),'telegramUserId':row['telegram_user_id'],
          'status':row['status'],'assignedTelegramId':row['assigned_telegram_id'],
          'createdAt':iso(row['created_at']),'updatedAt':iso(row['updated_at']),
          'closedAt':iso(row['closed_at'])},
          'account':{'id':str(user['id']),'name':user['name'],'email':user['email'] if staff_ok else None,
           'accountStatus':user['account_status'],'role':user['role']} if user else None,
          'contact':{'username':contact['username'],'blocked':bool(contact['bot_blocked_at']),
           'removed':bool(contact['removed_at'])} if contact else None,
          'messages':[{'id':str(m['id']),'senderType':m['sender_type'],
            'senderTelegramId':m['sender_telegram_id'],'messageType':m['message_type'],
            'text':m['text'],'fileName':m['file_name'],'deliveryStatus':m['delivery_status'],
            'createdAt':iso(m['created_at'])} for m in messages]})


@router.post('/api/internal/telegram/support/threads/{id}/messages')
async def support_reply(req:Request,id:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    body=body_obj(await core.payload(req))
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'SUPPORT')
        if error:return denied_response(error)
        typ,text,file_id,file_name,mime=message_fields(body)
        if (typ=='text' and not text) or (typ!='text' and not file_id):return core.j({'error':'invalid_input'},400)
        row=await conn.fetchrow('SELECT id,telegram_user_id,status FROM telegram_support_threads WHERE id=$1',id)
        if not row:return core.j({'error':'not_found'},404)
        if row['status']=='closed':return core.j({'error':'closed'},409)
        contact=await conn.fetchrow('''SELECT chat_id,first_name,bot_blocked_at,removed_at
                 FROM telegram_contacts WHERE telegram_user_id=$1''',row['telegram_user_id'])
        blocked=not contact or bool(contact['bot_blocked_at'] or contact['removed_at'])
        reason=('blocked' if contact and contact['bot_blocked_at'] else
                'removed' if contact and contact['removed_at'] else 'unavailable') if blocked else None
        msg=await conn.fetchrow('''INSERT INTO telegram_support_messages
          (thread_id,sender_type,sender_user_id,sender_telegram_id,message_type,text,
           telegram_file_id,file_name,mime_type,delivery_status,delivery_error)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id''',id,
          'owner' if actor['isPrimaryOwner'] else 'admin',actor['auditUserId'],actor['telegramUserId'],
          typ,text,file_id,file_name,mime,'blocked' if blocked else 'queued',reason)
        await conn.execute('''UPDATE telegram_support_threads SET status='waiting_for_user',
                    last_message_at=NOW(),updated_at=NOW() WHERE id=$1''',id)
        user=await conn.fetchrow('SELECT name FROM users WHERE telegram_id=$1 LIMIT 1',row['telegram_user_id'])
        return core.j({'ok':True,'messageId':str(msg['id']) if msg else None,
          'delivery':'blocked' if blocked else 'queued',
          'chatId':None if blocked else contact['chat_id'] or row['telegram_user_id'],
          'target':{'threadId':id,'telegramUserId':row['telegram_user_id'],
            'name':(user['name'] if user else None) or (contact['first_name'] if contact else None) or row['telegram_user_id']},
          'text':text,'messageType':typ,'fileId':file_id})


@router.post('/api/internal/telegram/support/threads/{id}/actions')
async def support_action(req:Request,id:str):
    denied=verify_bot(req)
    if denied is not None:return denied
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    body=body_obj(await core.payload(req));action=body.get('action')
    db=await core.pool()
    async with db.acquire() as conn:
        if action=='delivery':
            message_id=body.get('messageId');status=body.get('status')
            if not core.uuid_value(message_id) or status not in ('sent','failed','blocked'):
                return core.j({'error':'invalid_input'},400)
            err=body.get('error')[:300] if isinstance(body.get('error'),str) else None
            result=await conn.fetchrow('''UPDATE telegram_support_messages SET delivery_status=$2,
              delivery_error=$3 WHERE id=$1 RETURNING id,delivery_status''',message_id,status,err)
            return core.j({'ok':True,'deliveryStatus':result['delivery_status']}) if result else core.j({'error':'not_found'},404)
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'SUPPORT')
        if error:return denied_response(error)
        if action not in ('assign','close','reopen'):return core.j({'error':'invalid_input'},400)
        row=await conn.fetchrow('''SELECT id,status FROM telegram_support_threads WHERE id=$1''',id)
        if not row:return core.j({'error':'not_found'},404)
        if action=='assign':
            who=body.get('assigneeTelegramId')
            # Route uses String(body?.assigneeTelegramId ?? ""); numbers are cast to JS strings.
            if isinstance(who,(int,float)) and not isinstance(who,bool):who=str(who)
            if not valid_actor(who):return core.j({'error':'invalid_input'},409)
            await conn.execute('''UPDATE telegram_support_threads SET assigned_telegram_id=$2,
                     updated_at=NOW() WHERE id=$1''',id,who)
            await audit(conn,actor,'support.assigned','telegram_support_thread',id,{'assigneeTelegramId':who})
            return core.j({'ok':True,'status':row['status']})
        if action=='close':
            if row['status']=='closed':return core.j({'error':'already_closed'},409)
            await conn.execute('''UPDATE telegram_support_threads SET status='closed',
                   closed_at=NOW(),updated_at=NOW() WHERE id=$1 AND status<>'closed' ''',id)
            await audit(conn,actor,'support.closed','telegram_support_thread',id)
            return core.j({'ok':True,'status':'closed'})
        await conn.execute('''UPDATE telegram_support_threads SET status='open',
                  closed_at=NULL,updated_at=NOW() WHERE id=$1''',id)
        await audit(conn,actor,'support.reopened','telegram_support_thread',id)
        return core.j({'ok':True,'status':'open'})


@router.post('/api/internal/telegram/drafts')
async def flow_drafts(req:Request):
    denied=verify_bot(req)
    if denied is not None:return denied
    body=body_obj(await core.payload(req))
    actor=body.get('actorTelegramId') if isinstance(body.get('actorTelegramId'),str) else ''
    action=body.get('action');data=body.get('payload') if isinstance(body.get('payload'),dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        if action=='create':
            if not valid_actor(actor) or body.get('kind') not in DRAFT_KINDS:return core.j({'error':'invalid_input'},400)
            row=await conn.fetchrow('''INSERT INTO telegram_flow_drafts(actor_telegram_id,kind,payload,expires_at)
             VALUES($1,$2,$3::jsonb,NOW()+INTERVAL '10 minutes') RETURNING id,expires_at''',
             actor,body['kind'],json.dumps(data))
            if not row:return core.j({'error':'invalid_input'},400)
            return core.j({'ok':True,'id':str(row['id']),'expiresAt':iso(row['expires_at'])})
        if action in ('update','read','claim'):
            draft_id=body.get('id')
            if not core.uuid_value(draft_id) or not valid_actor(actor):return core.j({'error':'invalid_input'},404)
            conditions=('AND kind=$3' if action=='claim' and isinstance(body.get('kind'),str) and body.get('kind') else '')
            if action=='read':
                row=await conn.fetchrow('''SELECT id,kind,payload FROM telegram_flow_drafts
                  WHERE id=$1 AND actor_telegram_id=$2 AND consumed_at IS NULL AND expires_at>NOW()''',draft_id,actor)
            elif action=='update':
                row=await conn.fetchrow('''UPDATE telegram_flow_drafts SET payload=$3::jsonb,
                  expires_at=NOW()+INTERVAL '10 minutes' WHERE id=$1 AND actor_telegram_id=$2
                  AND consumed_at IS NULL AND expires_at>NOW() RETURNING id''',draft_id,actor,json.dumps(data))
            else:
                args=(draft_id,actor,body.get('kind')) if conditions else (draft_id,actor)
                row=await conn.fetchrow(f'''UPDATE telegram_flow_drafts SET consumed_at=NOW()
                  WHERE id=$1 AND actor_telegram_id=$2 AND consumed_at IS NULL AND expires_at>NOW()
                  {conditions} RETURNING id,kind,payload''',*args)
            if not row:return core.j({'error':'not_found'},404)
            if action=='update':return core.j({'ok':True,'id':str(row['id'])})
            return core.j({'ok':True,'id':str(row['id']),'kind':row['kind'],'payload':jsonb(row['payload'])})
        return core.j({'error':'invalid_input'},400)


def install():core.app.include_router(router)
