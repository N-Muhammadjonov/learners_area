"""Telegram website-user directory and guarded account maintenance API.
Source: src/lib/telegram/{directory,messages,identity,contacts}.ts.
"""
from __future__ import annotations
import math
from datetime import datetime, timezone
from fastapi import APIRouter,Request
from fastapi.responses import Response
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
        where=["u.role <> 'guardian'"];args=[]
        if status in ('pending','active','rejected','suspended'):
            args.append(status);where.append(f'u.account_status=${len(args)}')
        if role in ('student','teacher','admin','owner'):
            args.append(role);where.append(f'u.role=${len(args)}')
        elif role:
            return core.j({'items': [], 'page': page, 'pageSize': 10, 'total': 0})
        if q:
            args.extend((sql_like(q[:80]),t,sql_like(t[:80])))
            a,b,c=range(len(args)-2,len(args)+1)
            where.append(f'''(u.name ILIKE ${a} OR u.email ILIKE ${a} OR u.telegram_id=${b}
             OR EXISTS (SELECT 1 FROM telegram_contacts tc WHERE tc.linked_user_id=u.id AND tc.username ILIKE ${c}))''')
        filter_sql=' AND '.join(where) or 'TRUE'
        users=await conn.fetch(f'''SELECT u.id,u.name,u.email,u.role,u.account_status,u.telegram_id,u.created_at,
              tc.username
          FROM users u LEFT JOIN LATERAL
            (SELECT c.username FROM telegram_contacts c
               WHERE c.telegram_user_id=u.telegram_id OR c.linked_user_id=u.id
               ORDER BY c.updated_at DESC LIMIT 1) tc ON TRUE
          WHERE {filter_sql}
          ORDER BY (tc.username IS NULL OR tc.username=''),
                   lower(tc.username) NULLS LAST,lower(u.name),u.id LIMIT {limit}''',*args)
        count=await conn.fetchval(f'SELECT count(*)::int FROM users u WHERE {filter_sql}',*args)
        contacts=[];contacts_count=0
        # Intentional: any role/status string excludes Telegram-only contacts,
        # even unrecognised filters, matching the source.
        if not status and not role:
            params=[sql_like(q[:80]),sql_like(t[:80]),t] if q else []
            extras=('AND (first_name ILIKE $1 OR last_name ILIKE $1 OR username ILIKE $2 OR telegram_user_id=$3)' if q else '')
            contacts=await conn.fetch(f'''SELECT id,telegram_user_id,username,first_name,last_name,
                bot_blocked_at,removed_at,last_seen_at FROM telegram_contacts
                WHERE linked_user_id IS NULL {extras}
                  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.telegram_id=telegram_contacts.telegram_user_id)
                  AND NOT EXISTS (SELECT 1 FROM guardian_profiles gp
                      WHERE gp.telegram_user_id=telegram_contacts.telegram_user_id)
                  ORDER BY lower(coalesce(username,first_name,'')),id LIMIT {limit}''',*params)
            contacts_count=await conn.fetchval(f'''SELECT count(*)::int FROM telegram_contacts
                WHERE linked_user_id IS NULL {extras}
                  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.telegram_id=telegram_contacts.telegram_user_id)
                  AND NOT EXISTS (SELECT 1 FROM guardian_profiles gp
                      WHERE gp.telegram_user_id=telegram_contacts.telegram_user_id)''',*params)
        items=[]
        for r in users:
            data=row_to_dict(r)
            items.append({'id':data['id'],'name':r['name'],'email':r['email'],'role':r['role'],
              'accountStatus':r['account_status'],'telegramId':r['telegram_id'],
              'createdAt':jsiso(r['created_at']),'entryType':'website_user','telegramLinked':bool(r['telegram_id']),
              'username':r['username']})
        for r in contacts:
            name=(' '.join((r['first_name'] or '',r['last_name'] or ''))).strip() or ('@'+r['username'] if r['username'] else r['telegram_user_id'])
            items.append({'id':str(r['id']),'entryType':'telegram_contact','telegramUserId':r['telegram_user_id'],
              'username':r['username'],'name':name,'email':None,'role':None,'accountStatus':None,
              'telegramLinked':True,'botBlocked':bool(r['bot_blocked_at']), 'botRemoved':bool(r['removed_at']),
              'createdAt':jsiso(r['last_seen_at'])})
        # Original lists are individually capped at page*10 and merged by date.
        items.sort(key=lambda e:(not bool(e.get('username')), (e.get('username') or e.get('name') or '').casefold(),str(e.get('id') or '')))
        return core.j({'items':items[offset:offset+10],'page':page,'pageSize':10,'total':int(count or 0)+int(contacts_count or 0)})



def _directory_page(raw):
    try:
        value = int(raw or '1')
    except (TypeError, ValueError):
        value = 1
    return max(1, min(value, 100000))


@router.get('/api/internal/telegram/parents')
async def parent_directory(req: Request):
    denied = verify_bot(req)
    if denied is not None:
        return denied
    db = await core.pool()
    async with db.acquire() as conn:
        actor, error = await actor_for(conn, req.query_params.get('actorTelegramId'), 'VIEW_USERS')
        if error:
            return denied_response(error)
        page = _directory_page(req.query_params.get('page'))
        search = (req.query_params.get('q') or '').strip()[:80]
        args = []
        condition = ''
        if search:
            args = [sql_like(search), search.lstrip('@'), sql_like(search.lstrip('@'))]
            condition = ''' AND (p.display_name ILIKE $1 OR p.telegram_user_id=$2
                OR EXISTS (SELECT 1 FROM telegram_contacts c WHERE c.telegram_user_id=p.telegram_user_id
                  AND (c.username ILIKE $3 OR c.phone_number ILIKE $1)))'''
        base = ''' FROM guardian_profiles p
            LEFT JOIN telegram_contacts t ON t.telegram_user_id=p.telegram_user_id
            WHERE TRUE ''' + condition
        total = await conn.fetchval('SELECT count(*)::int' + base, *args)
        rows = await conn.fetch('''SELECT p.id,p.display_name,p.telegram_user_id,t.username,t.phone_number,
           t.phone_verified_at,t.bot_blocked_at,t.removed_at''' + base +
           ''' ORDER BY (t.username IS NULL),lower(coalesce(t.username,p.display_name,'')),p.id
               LIMIT 10 OFFSET $''' + str(len(args)+1), *args, (page-1)*10)
        return core.j({'page':page,'pageSize':10,'total':int(total or 0),
            'items':[{'profileId':str(r['id']),'name':r['display_name'] or '—',
                'username':r['username'],'telegramId':r['telegram_user_id'],
                'phone':r['phone_number'] if actor['isPrimaryOwner'] and r['phone_verified_at'] else None,
                'botBlocked':bool(r['bot_blocked_at']),'botRemoved':bool(r['removed_at'])}
                for r in rows]}, headers=core.PRIVATE)


@router.get('/api/internal/telegram/parents/{profileId}')
async def parent_detail(req: Request, profileId: str):
    denied = verify_bot(req)
    if denied is not None:
        return denied
    if not uuid_ok(profileId):
        return core.j({'error':'not_found'},404)
    db = await core.pool()
    async with db.acquire() as conn:
        actor,error = await actor_for(conn,req.query_params.get('actorTelegramId'),'VIEW_USERS')
        if error:
            return denied_response(error)
        p = await conn.fetchrow('''SELECT p.id,p.display_name,p.telegram_user_id,p.user_id,
            t.username,t.phone_number,t.phone_verified_at,t.bot_blocked_at,t.removed_at
            FROM guardian_profiles p LEFT JOIN telegram_contacts t
            ON t.telegram_user_id=p.telegram_user_id WHERE p.id=$1''',profileId)
        if not p:
            return core.j({'error':'not_found'},404)
        links = await conn.fetch('''SELECT l.student_id,l.relationship,l.status,u.name AS student_name
            FROM guardian_links l JOIN users u ON u.id=l.student_id
            WHERE l.guardian_profile_id=$1 AND l.status='linked'
            ORDER BY u.name,l.student_id LIMIT 30''',profileId)
        return core.j({'parent':{'profileId':str(p['id']),'name':p['display_name'] or '—',
            'telegramId':p['telegram_user_id'],'username':p['username'],
            'phone':p['phone_number'] if actor['isPrimaryOwner'] and p['phone_verified_at'] else None,
            'botBlocked':bool(p['bot_blocked_at']),'botRemoved':bool(p['removed_at']),
            'userId':str(p['user_id']) if p['user_id'] else None},
            'students':[{'userId':str(x['student_id']),'name':x['student_name'],
                'relationship':x['relationship'],'status':x['status']} for x in links]},
            headers=core.PRIVATE)


@router.get('/api/internal/telegram/directory/{userId}/parents')
async def student_parents(req: Request, userId: str):
    denied = verify_bot(req)
    if denied is not None:
        return denied
    if not uuid_ok(userId):
        return core.j({'error':'not_found'},404)
    db = await core.pool()
    async with db.acquire() as conn:
        actor,error = await actor_for(conn,req.query_params.get('actorTelegramId'),'VIEW_USERS')
        if error:
            return denied_response(error)
        valid = await conn.fetchval("SELECT 1 FROM users WHERE id=$1 AND role='student'",userId)
        if not valid:
            return core.j({'error':'not_found'},404)
        rows = await conn.fetch('''SELECT p.id,p.display_name,t.username,l.relationship,l.status
            FROM guardian_links l JOIN guardian_profiles p ON p.id=l.guardian_profile_id
            LEFT JOIN telegram_contacts t ON t.telegram_user_id=p.telegram_user_id
            WHERE l.student_id=$1 AND l.status='linked'
            ORDER BY p.display_name,p.id LIMIT 30''',userId)
        return core.j({'items':[{'profileId':str(x['id']),'name':x['display_name'] or '—',
            'username':x['username'],'relationship':x['relationship'],'status':x['status']}
            for x in rows]},headers=core.PRIVATE)


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
        if not user or user['role']=='guardian':return core.j({'error':'not_found'},404)
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



@router.post('/api/internal/telegram/contacts/{telegramUserId}/remove')
async def remove_unlinked_telegram_contact(req:Request, telegramUserId:str):
    """Deactivate a Telegram-only contact; website accounts are not affected."""
    denied=verify_bot(req)
    if denied is not None:return denied
    from .telegram_preferences_port import valid_actor
    if not valid_actor(telegramUserId):return core.j({'error':'not_found'},404)
    body=await core.payload(req);body=body if isinstance(body,dict) else {}
    db=await core.pool()
    async with db.acquire() as conn:
        actor,error=await actor_for(conn,body.get('actorTelegramId'),'MANAGE_USERS',True)
        if error:return denied_response(error)
        if telegramUserId==await effective_owner_id(conn):return core.j({'error':'primary_owner_protected'},409)
        async with conn.transaction():
            # Lock the target contact before checking its linked identity.
            # Removing an unlinked contact must never alter a website account.
            record=await conn.fetchrow('''SELECT id,linked_user_id,removed_at FROM telegram_contacts
                WHERE telegram_user_id=$1 FOR UPDATE''',telegramUserId)
            if not record:return core.j({'error':'not_found'},404)
            linked=await conn.fetchval('SELECT id FROM users WHERE telegram_id=$1 LIMIT 1',telegramUserId)
            if record['linked_user_id'] or linked:return core.j({'error':'account_linked'},409)
            if record['removed_at']:return core.j({'ok':True,'already':True})
            result=await conn.execute('''UPDATE telegram_contacts SET removed_at=NOW(),phone_number=NULL,
                phone_verified_at=NULL,updated_at=NOW()
                WHERE telegram_user_id=$1 AND linked_user_id IS NULL''',telegramUserId)
            if result!='UPDATE 1':return core.j({'error':'account_linked'},409)
            await audit(conn,actor,'telegram.bot_contact_removed','telegram_contact',record['id'],{'targetTelegramId':telegramUserId})
        return core.j({'ok':True,'removed':True})


RESULT_QUERIES={
    'Listening':"""SELECT score,total_questions,status::text AS status,submitted_at AS happened
        FROM listening_attempts WHERE user_id=$1 ORDER BY submitted_at DESC NULLS LAST LIMIT 30""",
    'Reading':"""SELECT score,total_questions,status::text AS status,submitted_at AS happened
        FROM reading_attempts WHERE user_id=$1 ORDER BY submitted_at DESC NULLS LAST LIMIT 30""",
    'Writing':"""SELECT word_count,status::text AS status,submitted_at AS happened
        FROM writing_submissions WHERE user_id=$1 ORDER BY submitted_at DESC NULLS LAST LIMIT 30""",
    'Speaking':"""SELECT part::text AS part,status::text AS status,submitted_at AS happened
        FROM speaking_attempts WHERE user_id=$1 ORDER BY submitted_at DESC NULLS LAST LIMIT 30""",
    'Mock':"""SELECT raw_score,estimated_band,status,submitted_at AS happened
        FROM mock_attempts WHERE user_id=$1 ORDER BY submitted_at DESC NULLS LAST LIMIT 30""",
    'Evaluation':"""SELECT source_type,overall_estimate,checked_by_name,created_at AS happened
        FROM evaluations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30""",
}


async def _authorized_results(conn,telegram_actor,user_id):
    """Never infer academic access from bot admin permission alone."""
    actor,error=await actor_for(conn,telegram_actor,'VIEW_USERS',True)
    if error:return None,None,denied_response(error)
    subject=await conn.fetchrow('SELECT id,name,role FROM users WHERE id=$1',core.uuid_value(user_id))
    if not subject or subject['role']!='student':return None,None,core.j({'error':'not_found'},404)
    linked=await conn.fetchrow('SELECT id,role,account_status FROM users WHERE telegram_id=$1',telegram_actor)
    if not linked or linked['account_status']!='active':
        return None,None,core.j({'error':'forbidden'},403)
    if linked['role']=='owner' and actor['isPrimaryOwner']:
        return actor,subject,None
    if linked['role']=='teacher':
        assigned=await conn.fetchval("""SELECT 1 FROM teacher_student_links
           WHERE teacher_user_id=$1 AND student_user_id=$2 LIMIT 1""",linked['id'],subject['id'])
        if assigned:return actor,subject,None
    return None,None,core.j({'error':'forbidden'},403)


async def _student_result_lines(conn,subject):
    from .db import row_to_dict
    lines=[]
    counts={}
    for skill,sql in RESULT_QUERIES.items():
        rows=await conn.fetch(sql,subject['id'])
        counts[skill]=len(rows)
        lines.append(skill+': '+str(len(rows))+' recent records')
        for row in rows:
            record=row_to_dict(row)
            fields=', '.join(k+': '+str(v) for k,v in record.items() if v is not None)
            lines.append('  '+fields[:450])
    return counts,lines


@router.get('/api/internal/telegram/directory/{userId}/results')
async def directory_results(req:Request,userId:str):
    """Owner/assigned-teacher academic summary and on-demand PDF/DOCX export.

    Do not return a public file URL. The bot receives bytes via its shared-secret
    channel and delivers to the already authorized Telegram actor.
    """
    denied=verify_bot(req)
    if denied is not None:return denied
    if not uuid_ok(userId):return core.j({'error':'not_found'},404)
    actor_id=req.query_params.get('actorTelegramId')
    fmt=req.query_params.get('format') or 'summary'
    if fmt not in ('summary','pdf','docx'):return core.j({'error':'invalid_format'},400)
    # Do not hold an open DB lease while invoking the rate limiter or
    # rendering large documents. The limit can acquire its own connection.
    if fmt!='summary':
        from .rate_limit import RULES,async_counter as counter,too_many
        RULES.setdefault('telegram_results_export',(4,60))
        limited=await counter('telegram_results_export',str(actor_id),consume=True)
        if limited:return too_many(limited)
    db=await core.pool()
    async with db.acquire() as conn:
        actor,subject,error=await _authorized_results(conn,actor_id,userId)
        if error is not None:return error
        counts,lines=await _student_result_lines(conn,subject)
    if fmt=='summary':
        return core.j({'studentName':subject['name'],'counts':counts},
                      headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
    from .step36_student_export import pdf_bytes,docx_bytes
    from .rate_limit import RULES
    import hashlib
    title='Learners Area - '+subject['name']+' - academic results'
    try:
        content=pdf_bytes(title,lines,userId) if fmt=='pdf' else docx_bytes(title,lines)
    except Exception:
        return core.j({'error':'export_unavailable'},503,
                      {'Cache-Control':'private, no-store'})
    # Record the disclosure only after successfully producing the document.
    # Fail closed: if audit persistence fails, do not send learner records.
    async with db.acquire() as conn:
        await audit(conn,actor,'report.downloaded','student',subject['id'],{
            'format':fmt,'source':'telegram_bot','bytes':len(content),
            'sha256':hashlib.sha256(content).hexdigest()})
    media='application/pdf' if fmt=='pdf' else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    return Response(content,media_type=media,headers={
        'Content-Disposition':f'attachment; filename="student-results-{userId}.{fmt}"',
        'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

def install():core.app.include_router(router)
