"""Real PostgreSQL/ASGI checks on an owned disposable database only.

Run: python tests/performance_phase2/integration_followup.py --output /tmp/qa
No supplied DSN is accepted. No mocks replace authentication or authorization.
"""
from __future__ import annotations
import argparse,asyncio,base64,json,os,time,uuid
from pathlib import Path
import httpx
from isolated_db import OwnedDatabase,UID,PASSWORD


async def run(out):
    out.mkdir(parents=True,exist_ok=True)
    db=OwnedDatabase(out);clients=[];cases=[]
    def verify(name,condition,**evidence):
        cases.append({'name':name,'pass':bool(condition),**evidence})
        print(('PASS ' if condition else 'FAIL ')+name,flush=True)
    async def request(client,method,path,status,**kwargs):
        r=await client.request(method,path,**kwargs)
        verify(method+' '+path+' -> '+str(status),r.status_code==status,status=r.status_code,
               **({'error':r.text[:240]} if r.status_code!=status else {}))
        return r
    started=time.monotonic()
    try:
        await db.start()
        from app import asgi
        from app.db import pool,close_pool
        from browser_fixtures import id as fid
        p=await pool()
        roles={'student':UID,**{r:fid(r) for r in ('teacher','other-teacher','other-student','admin','owner')}}
        tg={r:str(101001+i) for i,r in enumerate(roles)}
        async with p.acquire() as c:
            for role,ident in roles.items():
                await c.execute('UPDATE users SET telegram_id=$2,last_active_at=now() WHERE id=$1',ident,tg[role])
            await c.execute("INSERT INTO telegram_bot_settings(key,value) VALUES('primary_owner_telegram_id',$1::jsonb)",{'telegramUserId':tg['owner']})
            for role in ('teacher','other-teacher','admin'):
                await c.execute('INSERT INTO telegram_bot_admins(telegram_user_id,linked_user_id,permissions,is_active) VALUES($1,$2,$3::jsonb,true)',tg[role],roles[role],['VIEW_USERS','MANAGE_USERS'])
            for target,linked in (('201001',None),('201002',UID)):
                await c.execute('INSERT INTO telegram_contacts(telegram_user_id,chat_id,linked_user_id,phone_number) VALUES($1,$1,$2,$3)',target,linked,'+0000000000')
        os.environ['BOT_SERVICE_SECRET']='isolated-integration-bot-token-only'
        transport=httpx.ASGITransport(app=asgi.application)
        users={}
        for role in roles:
            client=httpx.AsyncClient(transport=transport,base_url='http://localhost:4173',headers={'Origin':'http://localhost:4173'})
            clients.append(client)
            email='phase2@example.test' if role=='student' else role+'@browser.example.test'
            await request(client,'POST','/api/auth/login',200,json={'email':email,'password':PASSWORD})
            users[role]=client
        bot=httpx.AsyncClient(transport=transport,base_url='http://localhost:4173',headers={'Authorization':'Bearer '+os.environ['BOT_SERVICE_SECRET']})
        clients.append(bot)
        result_path='/api/internal/telegram/directory/'+UID+'/results'
        for role,status in (('owner',200),('teacher',200),('other-teacher',403),('admin',403),('student',403)):
            await request(bot,'GET',result_path,status,params={'actorTelegramId':tg[role]})
        r=await request(bot,'GET','/api/internal/telegram/directory/'+fid('other-student')+'/results',403,params={'actorTelegramId':tg['teacher']})
        for fmt,magic in (('pdf',b'%PDF-'),('docx',b'PK')):
            r=await request(bot,'GET',result_path,200,params={'actorTelegramId':tg['owner'],'format':fmt})
            verify('results '+fmt+' private binary export',r.content.startswith(magic) and 'no-store' in r.headers.get('cache-control',''))
        remove='/api/internal/telegram/contacts/201001/remove'
        await request(bot,'POST',remove,403,json={'actorTelegramId':tg['student']})
        await request(bot,'POST',remove,200,json={'actorTelegramId':tg['owner']})
        await request(bot,'POST',remove,200,json={'actorTelegramId':tg['owner']})
        async with p.acquire() as c:
            row=await c.fetchrow("SELECT removed_at,phone_number FROM telegram_contacts WHERE telegram_user_id='201001'")
            verify('contact removal clears phone and records removal',row['removed_at'] is not None and row['phone_number'] is None)
            count=await c.fetchval("SELECT count(*) FROM audit_log WHERE action='telegram.bot_contact_removed'")
            verify('repeated contact removal writes one audit event',count==1,count=count)
        await request(bot,'POST','/api/internal/telegram/contacts/201002/remove',409,json={'actorTelegramId':tg['owner']})
        await request(bot,'POST','/api/internal/telegram/contacts/'+tg['owner']+'/remove',409,json={'actorTelegramId':tg['owner']})
        async with p.acquire() as c:
            verify('linked website learner remains active',await c.fetchval('SELECT account_status::text FROM users WHERE id=$1',UID)=='active')
        for role in ('student','teacher','owner'):
            r=await request(users[role],'GET','/api/riwi/materials?kind=reading',200)
            verify(role+' sees only three published Reading fixtures',len(r.json().get('items',[]))==3)
        await request(users['admin'],'GET','/api/riwi/materials?kind=reading',403)
        r=await request(users['student'],'GET','/api/riwi/materials?kind=listening',200)
        verify('uncompleted Listening transcripts stay hidden',r.json().get('items')==[])
        await request(users['student'],'GET','/api/riwi/materials?kind=invalid',400)
        r=await request(users['student'],'GET','/api/riwi/materials',200,params={'kind':'reading','q':"' OR 1=1 --"})
        verify('material query remains a bound search parameter',r.json().get('items')==[])
        conv=str(uuid.uuid4());foreign=str(uuid.uuid4())
        async with p.acquire() as c:
            for cid,owner in ((conv,UID),(foreign,fid('other-student'))):
                await c.execute("INSERT INTO riwi_conversations(id,user_id,role_at_creation,locale,expires_at) VALUES($1,$2,'student','en',now()+interval '7 days')",cid,owner)
                await c.execute("INSERT INTO riwi_conversation_messages(conversation_id,role,content,metadata) VALUES($1,'user','Synthetic grammar question.','{}'::jsonb)",cid)
        archive='/api/riwi/conversations/'+conv+'/archive'
        await request(users['other-student'],'POST',archive,404,json={})
        await request(users['owner'],'POST',archive,404,json={})
        await request(users['student'],'POST',archive,200,json={})
        async with p.acquire() as c:
            first=await c.fetchval('SELECT expires_at FROM riwi_conversations WHERE id=$1',conv)
            remaining=await c.fetchval('SELECT extract(epoch FROM expires_at-now()) FROM riwi_conversations WHERE id=$1',conv)
            verify('owned archive retains a bounded thirty-minute window',0<float(remaining)<=1801,remainingSeconds=float(remaining))
        await request(users['student'],'POST',archive,200,json={})
        async with p.acquire() as c:
            verify('archive replay does not extend retention',await c.fetchval('SELECT expires_at FROM riwi_conversations WHERE id=$1',conv)==first)
        for fmt,magic in (('txt',b'Synthetic'),('docx',b'PK'),('pdf',b'%PDF-')):
            r=await request(users['student'],'POST','/api/riwi/documents/export',200,json={'mode':'create','format':fmt,'text':'Synthetic integration document.'})
            verify(fmt+' export has real expected bytes',base64.b64decode(r.json().get('document',{}).get('base64','')).startswith(magic))
        await request(users['student'],'POST','/api/riwi/documents/export',400,json={'mode':'create','format':'exe','text':'Synthetic'})
        started_reading=await request(users['student'],'POST','/api/reading/academic',200,json={'setId':fid('reading-set')})
        aid=started_reading.json()['id']
        await request(users['student'],'GET','/api/riwi/materials?kind=reading',403)
        await request(users['student'],'POST','/api/riwi/documents/export',403,json={'mode':'create','format':'txt','text':'Synthetic'})
        qid=fid('reading-1-1');body={'answers':[{'questionId':qid,'answer':'fixture'}]}
        await request(users['other-student'],'PATCH','/api/reading/attempts/'+aid,404,json=body)
        await request(users['student'],'PATCH','/api/reading/attempts/'+aid,200,json=body)
        from app.reading_draft import draft_hash
        initial_hash=draft_hash({qid:'fixture'})
        guarded={'expectedDraftHash':initial_hash,'answers':[{'questionId':qid,'answer':'tab-A'}]}
        first=await request(users['student'],'PATCH','/api/reading/attempts/'+aid,200,json=guarded)
        verify('guarded draft returns an authoritative acknowledgement',first.json().get('draftHash')==draft_hash({qid:'tab-A'}))
        stale={'expectedDraftHash':initial_hash,'answers':[{'questionId':qid,'answer':'stale-tab-B'}]}
        r=await request(users['student'],'PATCH','/api/reading/attempts/'+aid,409,json=stale)
        verify('stale draft has an explicit conflict code',r.json().get('error')=='draft_conflict')
        await request(users['student'],'PATCH','/api/reading/attempts/'+aid,200,json=guarded)
        async with p.acquire() as c:
            verify('stale tab cannot overwrite the acknowledged draft',await c.fetchval('SELECT user_answer FROM reading_answers WHERE attempt_id=$1 AND question_id=$2',aid,qid)=='tab-A')
        token=first.json()['draftHash']
        racers=[{'expectedDraftHash':token,'answers':[{'questionId':qid,'answer':value}]} for value in ('race-A','race-B')]
        rs=await asyncio.gather(*(users['student'].patch('/api/reading/attempts/'+aid,json=b) for b in racers))
        verify('concurrent draft writers serialize with one conflict',sorted(r.status_code for r in rs)==[200,409],statuses=[r.status_code for r in rs])
        # Real row locks arbitrate two simultaneous submissions; one event only.
        rs=await asyncio.gather(*(users['student'].post('/api/reading/attempts/'+aid+'/submit',json=body) for _ in range(2)))
        verify('concurrent Reading submit returns one success and one conflict',sorted(r.status_code for r in rs)==[200,409],statuses=[r.status_code for r in rs])
        await request(users['student'],'PATCH','/api/reading/attempts/'+aid,409,json=body)
        async with p.acquire() as c:
            n=await c.fetchval("SELECT count(*) FROM activity_events WHERE type='READING_ATTEMPT_COMPLETED' AND payload->>'attemptId'=$1",aid)
            verify('one completion event after duplicate submit',n==1,count=n)
            n=await c.fetchval('SELECT count(*) FROM reading_answers WHERE attempt_id=$1',aid)
            verify('one final row per forty-question assessment',n==40,count=n)
        # Pool must remain usable and all borrowed connections return.
        async with p.acquire() as c:verify('database remains responsive after mixed checks',await c.fetchval('SELECT 1')==1)
        verify('no pool leases retained',p.get_idle_size()==p.get_size(),size=p.get_size(),idle=p.get_idle_size())
    finally:
        for client in clients:await client.aclose()
        try:
            from app.db import close_pool
            await close_pool()
        finally:db.close()
        receipt={'scope':'owned PostgreSQL + real ASGI/auth; synthetic data only','stabilitySoak':'NOT_RUN_USER_RESERVED_MANUAL','elapsedSeconds':round(time.monotonic()-started,3),'cases':cases,'pass':sum(c['pass'] for c in cases),'fail':sum(not c['pass'] for c in cases)}
        (out/'integration.json').write_text(json.dumps(receipt,indent=2)+'\n')
    if not cases or any(not c['pass'] for c in cases):raise SystemExit(1)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    asyncio.run(run(parser.parse_args().output))
