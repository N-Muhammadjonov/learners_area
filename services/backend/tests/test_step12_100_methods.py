"""HTTP contract regression for all 20 Step 12 routes.
Fakes exercise validation, bot bearer, owner/admin RBAC, read/write scoping,
and query/response shape. They are NOT PostgreSQL integration tests.
"""
from __future__ import annotations
from datetime import datetime,timezone
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from app.rate_limit import BUCKETS
from test_migration_phase2 import FakePool

C=TestClient(core.app)
H={'Authorization':'Bearer local_test_bot'}
U=UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
V=UUID('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
NOW=datetime(2026,10,22,tzinfo=timezone.utc)

class DB:
    def __init__(self):
        self.calls=[];self.rows={};self.many={};self.values={}
    async def __aenter__(self):return self
    async def __aexit__(self,*args):return False
    def _find(self,table,q,default):
        for key,value in sorted(table.items(),key=lambda p:-len(p[0])):
            if key in q:return value
        return default
    async def fetchrow(self,q,*args):
        self.calls.append(('fetchrow',q,args));return self._find(self.rows,q,None)
    async def fetch(self,q,*args):
        self.calls.append(('fetch',q,args));return self._find(self.many,q,[])
    async def fetchval(self,q,*args):
        self.calls.append(('fetchval',q,args));return self._find(self.values,q,None)
    async def execute(self,q,*args):
        self.calls.append(('execute',q,args));return 'OK'
    async def executemany(self,q,args):
        self.calls.append(('executemany',q,args));return 'OK'


def setup(monkeypatch):
    monkeypatch.setenv('BOT_SERVICE_SECRET','local_test_bot')
    monkeypatch.setenv('TELEGRAM_OWNER_ID','100')
    BUCKETS.clear()
    db=DB()
    async def pool():return FakePool(db)
    monkeypatch.setattr(core,'pool',pool)
    return db


def test_all_20_bot_routes_require_service_bearer(monkeypatch):
    setup(monkeypatch)
    paths=[('GET','/api/internal/telegram/admins'),('POST','/api/internal/telegram/admins'),
      ('PATCH','/api/internal/telegram/admins/111'),('DELETE','/api/internal/telegram/admins/111'),
      ('POST','/api/internal/telegram/broadcasts'),('POST','/api/internal/telegram/broadcasts/claim'),
      ('GET','/api/internal/telegram/broadcasts/'+str(U)),('POST','/api/internal/telegram/broadcasts/'+str(U)),
      ('GET','/api/internal/telegram/directory'),('GET','/api/internal/telegram/directory/'+str(U)),
      ('POST','/api/internal/telegram/directory/'+str(U)+'/unlink'),
      ('POST','/api/internal/telegram/directory/'+str(U)+'/remove'),
      ('POST','/api/internal/telegram/directory/'+str(U)+'/message'),
      ('POST','/api/internal/telegram/directory/'+str(U)+'/status'),
      ('GET','/api/internal/telegram/support/threads'),('POST','/api/internal/telegram/support/threads'),
      ('GET','/api/internal/telegram/support/threads/'+str(U)),
      ('POST','/api/internal/telegram/support/threads/'+str(U)+'/messages'),
      ('POST','/api/internal/telegram/support/threads/'+str(U)+'/actions'),
      ('POST','/api/internal/telegram/drafts')]
    assert len(paths)==20
    for method,path in paths:
        result=C.request(method,path)
        assert result.status_code==401,(method,path,result.status_code,result.text)


def test_bot_admin_owner_only_and_permission_sanitization(monkeypatch):
    db=setup(monkeypatch)
    assert C.get('/api/internal/telegram/admins?actorTelegramId=xyz',headers=H).json()=={'error':'invalid_actor'}
    assert C.get('/api/internal/telegram/admins?actorTelegramId=102',headers=H).status_code==403
    assert C.get('/api/internal/telegram/admins?actorTelegramId=100',headers=H).json()=={'admins':[]}
    assert C.post('/api/internal/telegram/admins',headers=H,json={'actorTelegramId':'100','telegramUserId':'100'}).json()=={'error':'primary_owner_protected'}
    assert C.post('/api/internal/telegram/admins',headers=H,json={'actorTelegramId':'100','telegramUserId':'abc'}).status_code==409
    r=C.post('/api/internal/telegram/admins',headers=H,json={'actorTelegramId':'100','telegramUserId':'102','permissions':['SUPPORT','BOT_SETTINGS','SUPPORT','VIEW_USERS','bad']})
    assert r.status_code==200 and r.json()=={'ok':True,'permissions':['SUPPORT','VIEW_USERS']}
    assert any('telegram_bot_admins' in q and 'INSERT' in q for _,q,_ in db.calls)
    assert any('bot_admin.added' in repr(args) for _,_,args in db.calls)


def test_bot_admin_modify_and_revoke(monkeypatch):
    db=setup(monkeypatch)
    db.rows['SELECT id,permissions,is_active FROM telegram_bot_admins']={
        'id':U,'permissions':['SUPPORT','BOT_SETTINGS'],'is_active':True}
    r=C.patch('/api/internal/telegram/admins/101',headers=H,json={'actorTelegramId':'100','permissions':['VIEW_AUDIT'],'active':False})
    assert r.json()=={'ok':True,'permissions':['VIEW_AUDIT'],'active':False}
    assert any('bot_admin.permissions_changed' in repr(args) for _,_,args in db.calls)
    r=C.delete('/api/internal/telegram/admins/101?actorTelegramId=100',headers=H)
    assert r.json()=={'ok':True,'permissions':['SUPPORT'],'active':False}
    assert any('UPDATE telegram_bot_admins SET' in q and 'deactivated_at' in q for _,q,_ in db.calls)


def test_nonowner_cannot_gain_owner_bot_privileges(monkeypatch):
    db=setup(monkeypatch)
    db.rows['SELECT permissions, linked_user_id FROM telegram_bot_admins']={'permissions':['SUPPORT','MANAGE_BOT_ADMINS','BOT_SETTINGS','BROADCAST'],'linked_user_id':None}
    assert C.get('/api/internal/telegram/admins?actorTelegramId=202',headers=H).status_code==403
    assert C.get('/api/internal/telegram/support/threads?actorTelegramId=202',headers=H).status_code==200
    assert C.post('/api/internal/telegram/broadcasts',headers=H,json={'actorTelegramId':'202','audience':'invalid'}).json()=={'error':'invalid_audience'}


def test_broadcast_preview_and_disabled(monkeypatch):
    db=setup(monkeypatch)
    db.many['SELECT telegram_user_id,chat_id FROM telegram_contacts']=[{'telegram_user_id':'555','chat_id':'321'}]
    r=C.post('/api/internal/telegram/broadcasts',headers=H,json={'actorTelegramId':'100','audience':'all_bot_users','preview':True})
    assert r.json()=={'audience':'all_bot_users','recipientCount':1}
    assert not any('INSERT INTO telegram_broadcasts' in q for _,q,_ in db.calls)
    db.rows["key='broadcasts_enabled'"]={'value':False}
    r=C.post('/api/internal/telegram/broadcasts',headers=H,json={'actorTelegramId':'100','audience':'teachers','content':'Example'})
    assert r.status_code==403 and r.json()['error']=='broadcasts_disabled'


def test_broadcast_create_audits_and_claim_is_routed_correctly(monkeypatch):
    db=setup(monkeypatch)
    db.rows['INSERT INTO telegram_broadcasts']={'id':U}
    r=C.post('/api/internal/telegram/broadcasts',headers=H,json={'actorTelegramId':'100','audience':'active_students','content':' Hello '})
    assert r.status_code==200 and r.json()['status']=='sent'
    assert r.json()['id']==str(U)
    assert any('broadcast.created' in repr(args) for _,_,args in db.calls)
    r=C.post('/api/internal/telegram/broadcasts/claim',headers=H,json={})
    assert r.status_code==200 and r.json()=={'deliveries':[]}
    # claim must not be swallowed by the dynamic POST /{id} route.
    assert 'SELECT d.id FROM telegram_broadcast_deliveries' in db.calls[-1][1]


def test_broadcast_status_and_cancel_guards(monkeypatch):
    db=setup(monkeypatch)
    assert C.get('/api/internal/telegram/broadcasts/not-uuid?actorTelegramId=100',headers=H).status_code==404
    db.rows['FROM telegram_broadcasts WHERE id=']={'id':U,'audience':'teachers','status':'queued',
       'recipient_count':10,'sent_count':4,'failed_count':1,'blocked_count':0,'created_at':NOW,'completed_at':None}
    r=C.get('/api/internal/telegram/broadcasts/'+str(U)+'?actorTelegramId=100',headers=H)
    assert r.status_code==200 and r.json()['createdAt']=='2026-10-22T00:00:00.000Z'
    assert C.post('/api/internal/telegram/broadcasts/'+str(U),headers=H,json={'actorTelegramId':'100','action':'cancel'}).status_code==409
    db.rows["UPDATE telegram_broadcasts SET status='cancelled'"]={'id':U}
    assert C.post('/api/internal/telegram/broadcasts/'+str(U),headers=H,json={'actorTelegramId':'100','action':'cancel'}).json()=={'ok':True}


def test_directory_search_and_detail_obscure_private_email(monkeypatch):
    db=setup(monkeypatch)
    db.many['SELECT u.id,u.name']=[{'id':U,'name':'Example','email':'e@example.com','role':'student',
        'account_status':'active','telegram_id':'811','username':None,'created_at':NOW}]
    db.values['SELECT count(*)::int FROM users']=1
    r=C.get('/api/internal/telegram/directory?actorTelegramId=100&role=student',headers=H)
    assert r.status_code==200 and r.json()['items'][0]['entryType']=='website_user'
    assert r.json()['items'][0]['telegramLinked'] is True
    assert r.json()['total']==1
    db.rows['SELECT id,name,email,role,account_status,status_reason,locale,telegram_id']={
      'id':U,'name':'Example','email':'private@example.com','role':'student','account_status':'active',
      'status_reason':None,'locale':'en','telegram_id':None,'created_at':NOW,'last_active_at':None}
    # Staff only: unrelated bot actor gets forbidden
    assert C.get('/api/internal/telegram/directory/'+str(U)+'?actorTelegramId=777',headers=H).status_code==403
    r=C.get('/api/internal/telegram/directory/'+str(U)+'?actorTelegramId=100',headers=H)
    assert r.status_code==200 and r.json()['user']['email']=='private@example.com'


def test_directory_protect_primary_owner_and_unlink(monkeypatch):
    db=setup(monkeypatch)
    db.rows['SELECT id,telegram_id,role,account_status FROM users']={'id':U,'telegram_id':'100','role':'owner','account_status':'active'}
    assert C.post('/api/internal/telegram/directory/'+str(U)+'/unlink',headers=H,json={'actorTelegramId':'100'}).json()['error']=='primary_owner_protected'
    db.rows['SELECT id,telegram_id,role,account_status FROM users']={'id':U,'telegram_id':'544','role':'student','account_status':'active'}
    r=C.post('/api/internal/telegram/directory/'+str(U)+'/unlink',headers=H,json={'actorTelegramId':'100'})
    assert r.json()=={'ok':True,'already':False}
    assert any('telegram.unlinked' in repr(args) for _,_,args in db.calls)
    r=C.post('/api/internal/telegram/directory/'+str(U)+'/remove',headers=H,json={'actorTelegramId':'100'})
    assert r.json()=={'ok':True,'already':False}
    assert any('phone_verified_at=NULL' in q for _,q,_ in db.calls)


def test_directory_last_owner_guard_and_notification(monkeypatch):
    db=setup(monkeypatch)
    db.rows["SELECT id FROM users WHERE role='owner'"]={'id':V}
    db.rows['SELECT id,telegram_id,role,account_status FROM users']={'id':U,'telegram_id':None,'role':'owner','account_status':'active'}
    db.values["SELECT count(*)::int FROM users WHERE role='owner'"]=0
    r=C.post('/api/internal/telegram/directory/'+str(U)+'/status',headers=H,json={'actorTelegramId':'100','status':'suspended'})
    assert r.status_code==409 and r.json()['error']=='last_owner'
    assert not any('UPDATE users SET account_status' in q for _,q,_ in db.calls)
    db.values["SELECT count(*)::int FROM users WHERE role='owner'"]=1
    r=C.post('/api/internal/telegram/directory/'+str(U)+'/status',headers=H,json={'actorTelegramId':'100','status':'suspended','reason':'Paused'})
    assert r.status_code==200 and r.json()['status']=='suspended'
    assert any('INSERT INTO notifications' in q for _,q,_ in db.calls)


def test_directory_direct_message_queue_and_report(monkeypatch):
    db=setup(monkeypatch)
    uri='/api/internal/telegram/directory/'+str(U)+'/message'
    assert C.post(uri,headers=H,json={'actorTelegramId':'100','text':''}).status_code==400
    db.rows['SELECT id,name,telegram_id FROM users']={'id':U,'name':'A','telegram_id':'44'}
    db.rows['SELECT chat_id,bot_blocked_at,removed_at FROM telegram_contacts']={'chat_id':'555','bot_blocked_at':None,'removed_at':None}
    db.rows['INSERT INTO telegram_direct_messages']={'id':V}
    r=C.post(uri,headers=H,json={'actorTelegramId':'100','text':' hello '})
    assert r.status_code==200 and r.json()['chatId']=='555' and r.json()['text']=='hello'
    db.rows['UPDATE telegram_direct_messages SET status=']={'id':V,'status':'sent'}
    r=C.post(uri,headers=H,json={'report':True,'messageId':str(V),'status':'sent'})
    assert r.status_code==200 and r.json()=={'ok':True,'status':'sent'}


def test_support_list_requires_staff_and_keeps_scope(monkeypatch):
    db=setup(monkeypatch)
    assert C.get('/api/internal/telegram/support/threads?actorTelegramId=999',headers=H).status_code==403
    r=C.get('/api/internal/telegram/support/threads?actorTelegramId=100&filter=mine&page=2',headers=H)
    assert r.status_code==200 and r.json()['page']==2
    q,args=next((q,args) for kind,q,args in db.calls if kind=='fetch' and 'FROM telegram_support_threads t LEFT JOIN' in q)
    assert 'assigned_telegram_id=$1' in q and args==('100',)


def test_support_post_validation_and_notify_owner(monkeypatch):
    db=setup(monkeypatch)
    uri='/api/internal/telegram/support/threads'
    assert C.post(uri,headers=H,json={'telegramUserId':'bad','text':'hi'}).status_code==400
    assert C.post(uri,headers=H,json={'telegramUserId':'449','text':''}).status_code==400
    db.rows['INSERT INTO telegram_support_threads']={'id':U}
    db.rows['INSERT INTO telegram_support_messages']={'id':V}
    r=C.post(uri,headers=H,json={'telegramUserId':'449','text':'  Hello  '})
    assert r.status_code==200 and r.json()['threadId']==str(U)
    assert r.json()['notifyTelegramIds']==['100'] and r.json()['preview']['text']=='Hello'


def test_support_thread_owner_email_redaction(monkeypatch):
    db=setup(monkeypatch)
    db.rows['SELECT id,telegram_user_id,status,assigned_telegram_id']={
       'id':U,'telegram_user_id':'554','status':'open','assigned_telegram_id':None,
       'created_at':NOW,'updated_at':NOW,'closed_at':None}
    db.rows['SELECT id,name,email,account_status,role FROM users']={
       'id':V,'name':'User','email':'private@test.local','account_status':'active','role':'student'}
    uri='/api/internal/telegram/support/threads/'+str(U)
    assert C.get(uri+'?actorTelegramId=887',headers=H).status_code==403
    r=C.get(uri+'?actorTelegramId=554',headers=H)
    assert r.status_code==200 and r.json()['account']['email'] is None
    r=C.get(uri+'?actorTelegramId=100',headers=H)
    assert r.json()['account']['email']=='private@test.local'


def test_support_reply_blocks_unreachable_recipient(monkeypatch):
    db=setup(monkeypatch)
    db.rows['SELECT id,telegram_user_id,status FROM telegram_support_threads']={
       'id':U,'telegram_user_id':'554','status':'open'}
    db.rows['INSERT INTO telegram_support_messages']={'id':V}
    uri='/api/internal/telegram/support/threads/'+str(U)+'/messages'
    r=C.post(uri,headers=H,json={'actorTelegramId':'100','text':'  Hi!  '})
    assert r.status_code==200 and r.json()['delivery']=='blocked' and r.json()['chatId'] is None
    assert r.json()['text']=='Hi!' and r.json()['messageType']=='text'
    assert any('delivery_status' in q and 'INSERT INTO' in q for _,q,_ in db.calls)


def test_support_actions_authority_and_delivery(monkeypatch):
    db=setup(monkeypatch)
    uri='/api/internal/telegram/support/threads/'+str(U)+'/actions'
    assert C.post(uri,headers=H,json={'action':'assign','actorTelegramId':'999','assigneeTelegramId':'201'}).status_code==403
    db.rows['SELECT id,status FROM telegram_support_threads']={'id':U,'status':'open'}
    r=C.post(uri,headers=H,json={'action':'assign','actorTelegramId':'100','assigneeTelegramId':'201'})
    assert r.status_code==200 and r.json()=={'ok':True,'status':'open'}
    assert any('support.assigned' in repr(args) for _,_,args in db.calls)
    db.rows['UPDATE telegram_support_messages SET delivery_status']={'id':V,'delivery_status':'sent'}
    r=C.post(uri,headers=H,json={'action':'delivery','messageId':str(V),'status':'sent'})
    assert r.status_code==200 and r.json()=={'ok':True,'deliveryStatus':'sent'}
    assert C.post(uri,headers=H,json={'action':'no_such_action','actorTelegramId':'100'}).status_code==400


def test_flow_draft_create_read_claim_is_owner_scoped(monkeypatch):
    db=setup(monkeypatch)
    uri='/api/internal/telegram/drafts'
    assert C.post(uri,headers=H,json={'action':'create','actorTelegramId':'invalid','kind':'dm'}).status_code==400
    assert C.post(uri,headers=H,json={'action':'create','actorTelegramId':'55','kind':'bad'}).status_code==400
    db.rows['INSERT INTO telegram_flow_drafts']={'id':U,'expires_at':NOW}
    r=C.post(uri,headers=H,json={'action':'create','actorTelegramId':'55','kind':'dm','payload':{'x':1}})
    assert r.status_code==200 and r.json()['expiresAt']=='2026-10-22T00:00:00.000Z'
    assert C.post(uri,headers=H,json={'action':'read','actorTelegramId':'other','id':str(U)}).status_code==404
    db.rows['SELECT id,kind,payload FROM telegram_flow_drafts']={'id':U,'kind':'dm','payload':{'x':1}}
    r=C.post(uri,headers=H,json={'action':'read','actorTelegramId':'55','id':str(U)})
    assert r.status_code==200 and r.json()['payload']=={'x':1}
    db.rows['UPDATE telegram_flow_drafts SET consumed_at']={'id':U,'kind':'dm','payload':{'x':1}}
    r=C.post(uri,headers=H,json={'action':'claim','actorTelegramId':'55','id':str(U),'kind':'dm'})
    assert r.status_code==200 and r.json()['kind']=='dm'
    assert 'AND kind=$3' in db.calls[-1][1]


def test_broadcast_claim_returns_only_claimed_payload(monkeypatch):
    db=setup(monkeypatch)
    db.many['SELECT d.id FROM telegram_broadcast_deliveries']=[{'id':U}]
    db.many['UPDATE telegram_broadcast_deliveries SET status=']=[
        {'id':U,'broadcast_id':V,'chat_id':'321','telegram_user_id':'654'}]
    db.many['SELECT id,content,message_type FROM telegram_broadcasts']=[
        {'id':V,'content':'Hello there','message_type':'text'}]
    r=C.post('/api/internal/telegram/broadcasts/claim',headers=H,json={'limit':999})
    assert r.status_code==200
    assert r.json()=={'deliveries':[{'deliveryId':str(U),'chatId':'321',
                                   'text':'Hello there','messageType':'text'}]}
    assert any('LIMIT $1' in query and args==(30,) for _,query,args in db.calls)
    assert any('lease_until=NOW()+' in query for _,query,_ in db.calls)


def test_flow_draft_update_expiration_and_actor_filter(monkeypatch):
    db=setup(monkeypatch)
    uri='/api/internal/telegram/drafts'
    r=C.post(uri,headers=H,json={'action':'update','actorTelegramId':'12','id':str(U),
                                  'payload':{'text':'  same  '}})
    assert r.status_code==404 and r.json()=={'error':'not_found'}
    db.rows['UPDATE telegram_flow_drafts SET payload=']={'id':U}
    r=C.post(uri,headers=H,json={'action':'update','actorTelegramId':'12','id':str(U),
                                  'payload':{'text':'  same  '}})
    assert r.json()=={'ok':True,'id':str(U)}
    assert any('actor_telegram_id=$2' in query and 'expires_at>NOW()' in query
               for kind,query,args in db.calls if kind=='fetchrow')


def test_support_close_reopen_and_block_closed_replies(monkeypatch):
    db=setup(monkeypatch)
    actions='/api/internal/telegram/support/threads/'+str(U)+'/actions'
    reply='/api/internal/telegram/support/threads/'+str(U)+'/messages'
    db.rows['SELECT id,status FROM telegram_support_threads']={'id':U,'status':'open'}
    r=C.post(actions,headers=H,json={'action':'close','actorTelegramId':'100'})
    assert r.status_code==200 and r.json()=={'ok':True,'status':'closed'}
    assert any('support.closed' in repr(args) for _,_,args in db.calls)
    db.rows['SELECT id,telegram_user_id,status FROM telegram_support_threads']={
        'id':U,'telegram_user_id':'654','status':'closed'}
    r=C.post(reply,headers=H,json={'actorTelegramId':'100','text':'Hello'})
    assert r.status_code==409 and r.json()=={'error':'closed'}
    db.rows['SELECT id,status FROM telegram_support_threads']={'id':U,'status':'closed'}
    r=C.post(actions,headers=H,json={'action':'reopen','actorTelegramId':'100'})
    assert r.status_code==200 and r.json()=={'ok':True,'status':'open'}
    assert any('support.reopened' in repr(args) for _,_,args in db.calls)


def test_recipient_role_filter_cast_and_active_status(monkeypatch):
    db=setup(monkeypatch)
    r=C.post('/api/internal/telegram/broadcasts',headers=H,json={
        'actorTelegramId':'100','audience':'admins','preview':True})
    assert r.status_code==200 and r.json()=={'audience':'admins','recipientCount':0}
    assert any('u.role::text=ANY($1::text[])' in query and args==(['admin','owner'],'active')
               for _,query,args in db.calls)
