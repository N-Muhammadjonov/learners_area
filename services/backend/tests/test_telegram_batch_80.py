"""Source-derived behavior tests for 10 new Telegram backend HTTP methods."""
import os
from datetime import datetime, timezone
from uuid import UUID
from fastapi.testclient import TestClient
from app import main as core
from test_migration_phase2 import FakePool

C=TestClient(core.app)
H={'Authorization':'Bearer demo_bot_token'}
U=UUID('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')

class DB:
    def __init__(self):self.calls=[];self.rows={};self.many={}
    async def __aenter__(self):return self
    async def __aexit__(self,*args):return False
    def transaction(self):return self
    async def fetchrow(self,q,*args):
        self.calls.append(('fetchrow',q,args))
        for k,value in sorted(self.rows.items(),key=lambda item:-len(item[0])):
            if k in q:return value
        return None
    async def fetch(self,q,*args):
        self.calls.append(('fetch',q,args))
        for k,value in self.many.items():
            if k in q:return value
        return []
    async def execute(self,q,*args):
        self.calls.append(('execute',q,args))
        return 'OK'


def stub(monkeypatch):
    monkeypatch.setenv('BOT_SERVICE_SECRET','demo_bot_token')
    monkeypatch.setenv('TELEGRAM_OWNER_ID','1234')
    db=DB()
    async def pool():return FakePool(db)
    monkeypatch.setattr(core,'pool',pool)
    return db


def test_new_bot_endpoints_refuse_missing_service_bearer(monkeypatch):
    stub(monkeypatch)
    urls=[('get','/api/internal/telegram/notifications?actorTelegramId=1234'),
          ('put','/api/internal/telegram/notifications'),
          ('post','/api/internal/telegram/notifications'),
          ('post','/api/internal/telegram/contacts'),
          ('get','/api/internal/telegram/contacts/567?actorTelegramId=1234'),
          ('get','/api/internal/telegram/required-channels?actorTelegramId=1234'),
          ('post','/api/internal/telegram/required-channels'),
          ('get','/api/internal/telegram/owner?actorTelegramId=1234'),
          ('get','/api/internal/telegram/ops?actorTelegramId=1234'),
          ('patch','/api/internal/telegram/ops')]
    for method,url in urls:
        r=getattr(C,method)(url)
        assert r.status_code==401,(method,url,r.status_code)


def test_notification_defaults_and_owner_independent(monkeypatch):
    db=stub(monkeypatch)
    assert C.get('/api/internal/telegram/notifications?actorTelegramId=abc',headers=H).status_code==400
    r=C.get('/api/internal/telegram/notifications?actorTelegramId=567',headers=H)
    assert r.status_code==200 and r.json()=={'locale':'uz','announcements':False,'reminders':False,'accountNotices':True}
    db.rows['SELECT notification_prefs,locale_override,language_code']={'notification_prefs':'{"announcements":true}','locale_override':None,'language_code':'en'}
    r=C.put('/api/internal/telegram/notifications',json={'actorTelegramId':'567','reminders':True},headers=H)
    assert r.json()=={'announcements':True,'reminders':True,'locale':'en','accountNotices':True}
    assert db.calls[-1][2][0]=='567'


def test_contacts_synchronized_and_blocked(monkeypatch):
    db=stub(monkeypatch)
    assert C.post('/api/internal/telegram/contacts',json={'telegramUserId':'abc'},headers=H).json()=={'error':'invalid_actor'}
    r=C.post('/api/internal/telegram/contacts',json={'telegramUserId':'789','blocked':True,'sync':False},headers=H)
    assert r.status_code==200 and r.json()=={'ok':True}
    assert 'bot_blocked_at' in db.calls[-1][1]
    db.rows['INSERT INTO telegram_contacts']={'id':U}
    r=C.post('/api/internal/telegram/contacts',json={'telegramUserId':'789','username':'@twelve ', 'restarted':True},headers=H)
    assert r.json()=={'ok':True,'contactId':str(U)}
    values=[args for kind,q,args in db.calls if kind=='fetchrow' and 'INSERT INTO telegram_contacts' in q][-1]
    assert values[2]=='twelve' and values[-1] is True


def test_owner_precedence_over_env_and_sensitive_contact(monkeypatch):
    db=stub(monkeypatch)
    db.rows["key='primary_owner_telegram_id'"]={'value':'{"telegramUserId":"9090"}'}
    assert C.get('/api/internal/telegram/owner?actorTelegramId=1234',headers=H).status_code==403
    assert C.get('/api/internal/telegram/owner?actorTelegramId=9090',headers=H).json()['source']=='database'
    assert C.get('/api/internal/telegram/contacts/678?actorTelegramId=1234',headers=H).status_code==403
    db.rows['SELECT telegram_user_id,username,phone_number']={'telegram_user_id':'678','username':'acct','phone_number':'+99899999','phone_verified_at':None}
    r=C.get('/api/internal/telegram/contacts/678?actorTelegramId=9090',headers=H)
    assert r.status_code==200 and r.json()['phoneNumber'] is None
    db.rows['SELECT telegram_user_id,username,phone_number']['phone_verified_at']=datetime.now(timezone.utc)
    r=C.get('/api/internal/telegram/contacts/678?actorTelegramId=9090',headers=H)
    assert r.json()['phoneVerified'] is True and r.json()['phoneNumber']=='+99899999'


def test_required_channels_owner_only_validation_duplicate_and_audit(monkeypatch):
    db=stub(monkeypatch)
    db.rows["key='required_channels'"]={'value':'[]'}
    r=C.get('/api/internal/telegram/required-channels?actorTelegramId=1234',headers=H)
    assert r.status_code==200 and r.json()['channels']==[]
    r=C.post('/api/internal/telegram/required-channels',json={'actorTelegramId':'1234','action':'add','channel':{'id':'777','title':'x','url':'https://t.me/abcd'}},headers=H)
    assert r.status_code==400 and r.json()['error']=='invalid_channel'
    r=C.post('/api/internal/telegram/required-channels',json={'actorTelegramId':'1234','action':'add','channel':{'id':'-100123456','title':'English','url':'https://t.me/english123'}},headers=H)
    assert r.status_code==200 and r.json()['channels'][0]['id']=='-100123456'
    assert any('bot_settings.changed' in q for _,q,_ in db.calls)
    db.rows["key='required_channels'"]={'value':'[{"id":"-100123456","title":"English","url":"https://t.me/english123"}]'}
    r=C.post('/api/internal/telegram/required-channels',json={'actorTelegramId':'1234','action':'add','channel':{'id':'-100123456','title':'Other','url':'https://t.me/example123'}},headers=H)
    assert r.status_code==200 and r.json()['channels'][0]['title']=='English'


def test_notification_post_claim_and_result(monkeypatch):
    db=stub(monkeypatch)
    assert C.post('/api/internal/telegram/notifications',headers=H,json={}).json()=={'notices':[]}
    assert C.post('/api/internal/telegram/notifications',headers=H,json={'results':[]}).json()=={'ok':True}
    r=C.post('/api/internal/telegram/notifications',headers=H,json={'results':[{'id':str(U),'status':'failed','retryAfterSeconds':30}]})
    assert r.status_code==200 and r.json()=={'ok':True}
    assert "status='queued'" in db.calls[-1][1]
    db.many['SELECT id FROM telegram_notifications']=[{'id':U}]
    db.many['UPDATE telegram_notifications SET status']=[{'id':U,'telegram_user_id':'567','title':'Hello','body':'Test','category':'critical','type':'account.approved','correlation_id':None}]
    db.many['SELECT telegram_user_id,chat_id,bot_blocked_at']=[{'telegram_user_id':'567','chat_id':'5566','bot_blocked_at':None,'removed_at':None}]
    r=C.post('/api/internal/telegram/notifications',headers=H,json={'limit':10})
    assert r.status_code==200 and r.json()['notices'][0]['chatId']=='5566'
    assert r.json()['notices'][0]['id']==str(U)


def test_ops_owner_audit_settings_and_config_write(monkeypatch):
    db=stub(monkeypatch)
    assert C.get('/api/internal/telegram/ops?actorTelegramId=9876&view=settings',headers=H).status_code==403
    assert C.patch('/api/internal/telegram/ops',headers=H,json={'actorTelegramId':'9876','key':'support_enabled','value':True}).status_code==403
    r=C.get('/api/internal/telegram/ops?actorTelegramId=1234&view=settings',headers=H)
    assert r.status_code==200 and r.json()['default_locale']=='uz'
    assert r.json()['broadcasts_enabled'] is True
    r=C.patch('/api/internal/telegram/ops',headers=H,json={'actorTelegramId':'1234','key':'primary_owner_telegram_id','value':'9999'})
    assert r.status_code==400
    r=C.patch('/api/internal/telegram/ops',headers=H,json={'actorTelegramId':'1234','key':'broadcasts_enabled','value':False})
    assert r.status_code==200 and r.json()=={'ok':True,'key':'broadcasts_enabled','value':False}
    db.many['FROM audit_log ORDER BY']=[{'action':'bot_settings.changed','target_type':'telegram_bot_setting','target_id':'default_locale','created_at':datetime(2026,1,1,tzinfo=timezone.utc),'metadata':{'value':'uz'}}]
    r=C.get('/api/internal/telegram/ops?actorTelegramId=1234&view=audit&page=2',headers=H)
    assert r.status_code==200 and r.json()['page']==2
    assert r.json()['entries'][0]['createdAt']=='2026-01-01T00:00:00.000Z'
    db.rows['SELECT id FROM users WHERE telegram_id']=None
    db.rows["SELECT id FROM users WHERE role='owner'"]=None
    db.rows['FROM users']={'pending':1,'active':2,'rejected':0,'suspended':0}
    db.rows['FROM telegram_contacts']={'contacts':3,'blocked':0,'removed':0}
    db.rows['FROM telegram_support_threads']={'open':1}
    r=C.get('/api/internal/telegram/ops?actorTelegramId=1234',headers=H)
    assert r.status_code==200 and r.json()['contacts']['contacts']==3


def test_owner_only_bot_settings_not_delegated(monkeypatch):
    db=stub(monkeypatch)
    db.rows['FROM telegram_bot_admins']={'permissions':'["VIEW_STATS","VIEW_AUDIT","BOT_SETTINGS"]','linked_user_id':U}
    r=C.get('/api/internal/telegram/ops?actorTelegramId=789&view=settings',headers=H)
    assert r.status_code==403
    r=C.get('/api/internal/telegram/ops?actorTelegramId=789&view=audit',headers=H)
    assert r.status_code==200
