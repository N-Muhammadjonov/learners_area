"""Login and registration must keep phone verification separate from membership."""
import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from app import main as core
from app import step18_telegram_admission_port as admission
from app import step19_telegram_exchange_port as exchange
from app.rate_limit import BUCKETS
from test_migration_phase2 import FakePool
from test_telegram_batch_80 import DB

ID=UUID('11111111-1111-4111-8111-111111111111')
CHANNEL={'id':'-1002094765480','title':'Learners area','url':'https://t.me/learners_area'}
HEADERS={'Authorization':'Bearer demo_bot_token'}

@pytest.fixture(autouse=True)
def reset_limits():
    BUCKETS.clear()
    yield
    BUCKETS.clear()

@pytest.mark.parametrize('membership,allowed',[
    ({'status':'left'},False),({'status':'kicked'},False),
    ({'status':'restricted','is_member':False},False),
    ({'status':'restricted','is_member':True},True),
    ({'status':'member'},True),({'status':'administrator'},True),({'status':'creator'},True),
])
def test_membership_is_enforced_when_flag_is_missing(monkeypatch,membership,allowed):
    import httpx
    monkeypatch.delenv('TELEGRAM_ACCESS_GATES_ENABLED',raising=False)
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN','test-bot-token')
    con=DB()
    con.rows['SELECT phone_number']={'phone_number':'+998900000000','phone_verified_at':datetime.now(timezone.utc)}
    monkeypatch.setattr(admission,'list_channels',AsyncMock(return_value=[CHANNEL]))
    response=Mock(is_success=True)
    response.json.return_value={'ok':True,'result':membership}
    client=AsyncMock()
    client.__aenter__.return_value=client
    client.get.return_value=response
    monkeypatch.setattr(httpx,'AsyncClient',Mock(return_value=client))
    result=asyncio.run(admission.gates(con,'12345'))
    assert result is None if allowed else result=={'error':'not_subscribed','requiredChannels':[CHANNEL]}
    assert client.get.call_args.kwargs['params']=={'chat_id':CHANNEL['id'],'user_id':'12345'}

def test_telegram_outage_never_allows_login(monkeypatch):
    import httpx
    monkeypatch.delenv('TELEGRAM_ACCESS_GATES_ENABLED',raising=False)
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN','test-bot-token')
    con=DB();con.rows['SELECT phone_number']={'phone_number':'+998900000000','phone_verified_at':datetime.now(timezone.utc)}
    monkeypatch.setattr(admission,'list_channels',AsyncMock(return_value=[CHANNEL]))
    client=AsyncMock();client.__aenter__.return_value=client
    client.get.side_effect=httpx.TimeoutException('unavailable')
    monkeypatch.setattr(httpx,'AsyncClient',Mock(return_value=client))
    assert asyncio.run(admission.gates(con,'12345'))['error']=='membership_unavailable'

def test_preflight_binds_actor_and_browser_reports_subscription_gate(monkeypatch):
    con=DB()
    con.rows['SELECT purpose']={'purpose':'register','telegram_user_id':None}
    con.rows['SELECT status,expires_at']={'status':'pending','expires_at':datetime.now(timezone.utc)+timedelta(minutes=5),'purpose':'register','telegram_user_id':'12345'}
    con.fetchval=AsyncMock(return_value=ID)
    monkeypatch.setenv('BOT_SERVICE_SECRET','demo_bot_token')
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    gate=AsyncMock(return_value={'error':'not_subscribed','requiredChannels':[CHANNEL]})
    monkeypatch.setattr(admission,'gates',gate)
    client=TestClient(core.app)
    r=client.post('/api/internal/telegram/auth/preflight',headers=HEADERS,json={'token':'one-time-token','telegramUserId':'12345'})
    assert r.status_code==403 and r.json()['requiredChannels']==[CHANNEL]
    assert con.fetchval.call_args.args[1:]==(hashlib.sha256(b'one-time-token').hexdigest(),'12345')
    r=client.get(f'/api/auth/telegram/intent/status?id={ID}&nonce=browser-secret')
    assert r.json()=={'status':'pending','expired':False,'gateError':'not_subscribed'}
    assert r.headers['cache-control']=='private, no-store' and 'set-cookie' not in r.headers
    assert con.calls[-1][2]==(ID,hashlib.sha256(b'browser-secret').hexdigest())

@pytest.mark.parametrize('path',['preflight','confirm'])
def test_another_telegram_actor_cannot_take_bound_intent(monkeypatch,path):
    con=DB()
    con.rows['SELECT purpose']={'purpose':'login','telegram_user_id':'54321'}
    con.rows['SELECT id,user_id']={'id':ID,'user_id':None,'telegram_user_id':'54321'}
    monkeypatch.setenv('BOT_SERVICE_SECRET','demo_bot_token')
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    gate=AsyncMock();monkeypatch.setattr(admission,'gates',gate)
    r=TestClient(core.app).post('/api/internal/telegram/auth/'+path,headers=HEADERS,json={'token':'one-time-token','telegramUserId':'12345'})
    assert r.status_code==409 and r.json()['error']=='intent_invalid'
    gate.assert_not_awaited()
    assert not any('UPDATE' in q for _,q,_ in con.calls)

@pytest.mark.parametrize('purpose',['login','register','link','replace'])
@pytest.mark.parametrize('error,status',[('not_subscribed',403),('membership_unavailable',503),('phone_required',403)])
def test_exchange_cannot_issue_session_or_create_account_without_membership(monkeypatch,purpose,error,status):
    con=DB()
    con.rows['SELECT * FROM telegram_login_intents']={'id':ID,'status':'confirmed','telegram_user_id':'12345','purpose':purpose,'user_id':None,'expires_at':datetime.now(timezone.utc)+timedelta(minutes=5)}
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    monkeypatch.setattr(core,'current_authority',AsyncMock(return_value=None))
    gate=AsyncMock(return_value={'error':error});monkeypatch.setattr(exchange,'gates',gate)
    issue=Mock();monkeypatch.setattr(core,'issue_token',issue)
    r=TestClient(core.app).post('/api/auth/telegram/intent/exchange',json={'intentId':str(ID),'browserNonce':'browser-secret','name':'Test User'})
    assert r.status_code==status and r.json()['error']==error
    assert 'set-cookie' not in r.headers
    issue.assert_not_called();gate.assert_awaited_once_with(con,'12345')
    assert not any(q.lstrip().startswith(('INSERT','UPDATE','DELETE')) for _,q,_ in con.calls)

def test_presence_passes_text_uuid_to_text_parameter(monkeypatch):
    con=DB()
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    monkeypatch.setattr(core,'current_user',AsyncMock(return_value={'id':ID}))
    r=TestClient(core.app).post('/api/presence',json={})
    assert r.status_code==204
    assert con.calls[-1][2]==(str(ID),)

@pytest.mark.parametrize('purpose,gender',[('login',None),('register','male'),('register','female')])
def test_subscribed_user_can_complete_login_or_register_and_cannot_replay(monkeypatch,purpose,gender):
    user={'id':ID,'name':'Test User','role':'student','locale':'uz','auth_version':0,
          'account_status':'active' if purpose=='login' else 'pending','onboarding_completed_at':None}
    intent={'id':ID,'status':'confirmed','telegram_user_id':'12345','purpose':purpose,
            'user_id':None,'language_code':'uz','expires_at':datetime.now(timezone.utc)+timedelta(minutes=5)}
    class ExchangeDB(DB):
        async def fetchrow(self,q,*args):
            self.calls.append(('fetchrow',q,args))
            if 'FROM telegram_login_intents' in q:return intent
            if 'FROM users WHERE telegram_id' in q:return user if purpose=='login' else None
            if 'INSERT INTO users' in q:
                assert args[:3]==('12345','Test User',gender)
                return user
        async def fetchval(self,q,*args):
            self.calls.append(('fetchval',q,args))
            if 'UPDATE telegram_login_intents' in q:
                if intent['status']!='confirmed':return None
                intent['status']='consumed'
            return ID
    con=ExchangeDB()
    monkeypatch.setenv('AUTH_SECRET','synthetic-test-secret-long-enough')
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    monkeypatch.setattr(core,'current_authority',AsyncMock(return_value=None))
    monkeypatch.setattr(exchange,'gates',AsyncMock(return_value=None))
    client=TestClient(core.app)
    body={'intentId':str(ID),'browserNonce':'browser-secret','name':'Test User',**({'gender':gender} if gender else {})}
    response=client.post('/api/auth/telegram/intent/exchange',json=body)
    assert response.status_code==200 and response.json()['success'] is True
    assert 'la_session=' in response.headers['set-cookie']
    assert response.json()['accountStatus']==user['account_status']
    assert intent['status']=='consumed'
    client.cookies.clear()
    replay=client.post('/api/auth/telegram/intent/exchange',json=body)
    assert replay.status_code==409 and replay.json()['error']=='already_consumed'
    assert 'set-cookie' not in replay.headers

@pytest.mark.parametrize('gender',[None,'','other',0,True,{},[]])
def test_new_registration_without_valid_gender_cannot_create_account(monkeypatch,gender):
    con=DB()
    con.rows['SELECT * FROM telegram_login_intents']={'id':ID,'status':'confirmed','telegram_user_id':'12345',
        'purpose':'register','user_id':None,'expires_at':datetime.now(timezone.utc)+timedelta(minutes=5)}
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=FakePool(con)))
    monkeypatch.setattr(core,'current_authority',AsyncMock(return_value=None))
    monkeypatch.setattr(exchange,'gates',AsyncMock(return_value=None))
    issue=Mock();monkeypatch.setattr(core,'issue_token',issue)
    body={'intentId':str(ID),'browserNonce':'browser-secret','name':'Test User','gender':gender}
    r=TestClient(core.app).post('/api/auth/telegram/intent/exchange',json=body)
    assert r.status_code==400
    assert r.json()['error']==('gender_required' if gender is None else 'invalid_input')
    assert 'set-cookie' not in r.headers;issue.assert_not_called()
    assert not any(q.lstrip().startswith(('INSERT','UPDATE','DELETE')) for _,q,_ in con.calls)
