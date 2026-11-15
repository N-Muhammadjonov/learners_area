"""Role/beneficiary boundaries and durable payment facts on real PostgreSQL."""
from __future__ import annotations

from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from app import tuition_ledger as ledger
from test_academy_learning_journey import journey, create_actor, request


@pytest_asyncio.fixture
async def family(journey):
    conn, client = journey
    actors = {role:await create_actor(conn,'QA '+role,role) for role in ('owner','admin','teacher','student','guardian')}
    actors['second'] = await create_actor(conn,'QA second child','student')
    actors['outsider'] = await create_actor(conn,'QA unlinked child','student')
    actors['other_guardian'] = await create_actor(conn,'QA other parent','guardian')
    profile = await conn.fetchval('''INSERT INTO guardian_profiles(telegram_user_id,user_id,display_name,channel_verified_at)
        VALUES('9001001',$1,'QA parent',now()) RETURNING id''',actors['guardian']['id'])
    links = {}
    for key in ('student','second'):
        links[key] = await conn.fetchval('''INSERT INTO guardian_links(guardian_profile_id,student_id,relationship,status,approved_at)
            VALUES($1,$2,'mother','linked',now()) RETURNING id''',profile,actors[key]['id'])
    await conn.execute('''INSERT INTO guardian_profiles(telegram_user_id,user_id,display_name,channel_verified_at)
        VALUES('9001002',$1,'QA other parent',now())''',actors['other_guardian']['id'])
    day = ledger.business_date(ledger.datetime.now(ledger.timezone.utc))
    for key, amount in (('student',900000),('second',300000)):
        charge=await ledger.create_charge(conn,actor_user_id=actors['admin']['id'],student_user_id=actors[key]['id'],
            period=ledger.period_key(day),gross_amount_minor=amount,due_date=day)
        await ledger.approve_charge(conn,actor_user_id=actors['owner']['id'],charge_id=charge['id'])
        await ledger.post_charge(conn,actor_user_id=actors['admin']['id'],charge_id=charge['id'])
    return conn,client,actors,links


def child_path(actors, key='student') -> str:
    return f"/api/guardian/children/{actors[key]['id']}/payments"


@pytest.mark.asyncio
async def test_guardian_linked_child_can_get_finance_summary(family):
    _,client,actors,_=family
    result=await request(client,actors['guardian'],'GET',child_path(actors))
    assert result['position']['balanceDueMinor']==900000
    assert result['billingPolicy']['mode']=='MONTHLY_INVOICE'
    assert 'daysLeft' not in result


@pytest.mark.asyncio
async def test_guardian_unlinked_child_finance_forbidden(family):
    _,client,actors,_=family
    await request(client,actors['guardian'],'GET',child_path(actors,'outsider'),403)
    await request(client,actors['other_guardian'],'GET',child_path(actors),403)


@pytest.mark.asyncio
async def test_guardian_revoked_link_cannot_start_intent(family):
    conn,client,actors,links=family
    await conn.execute("UPDATE guardian_links SET status='revoked',revoked_at=now() WHERE id=$1",links['student'])
    body={'amountMinor':150000,'provider':'payme','idempotencyKey':str(uuid4())}
    await request(client,actors['guardian'],'POST',child_path(actors)+'/intents',403,json=body)
    await request(client,actors['guardian'],'GET',child_path(actors),403)


@pytest.mark.asyncio
async def test_teacher_cannot_view_student_full_statement_without_finance_scope(family):
    conn,client,actors,_=family
    await conn.execute('INSERT INTO teacher_student_links(teacher_user_id,student_user_id) VALUES($1,$2)',
                       actors['teacher']['id'],actors['student']['id'])
    await request(client,actors['teacher'],'GET',f"/api/staff/finance/students/{actors['student']['id']}/statement",403)
    await request(client,actors['teacher'],'POST','/api/finance/me/intents',403,
                  json={'amountMinor':150000,'provider':'payme','idempotencyKey':str(uuid4())})


@pytest.mark.asyncio
async def test_guardian_payment_access_does_not_expand_progress_permissions(family):
    _,client,actors,_=family
    for path in ('/api/staff/finance/summary','/api/staff/finance/payroll','/api/finance/me'):
        await request(client,actors['guardian'],'GET',path,403)


@pytest.mark.asyncio
async def test_live_providers_disabled_without_credentials(family,monkeypatch):
    _,client,actors,_=family
    for provider in ('CLICK','PAYME','UZUM'):
        monkeypatch.delenv(provider+'_LIVE_VERIFIED',raising=False)
    result=await request(client,actors['student'],'GET','/api/finance/me/payments')
    assert {row['id'] for row in result['providers']}=={'click','payme','uzum'}
    assert all(not row['available'] and row['checkoutUrl'] is None for row in result['providers'])
    await request(client,actors['student'],'POST','/api/finance/me/intents',409,
                  json={'amountMinor':150000,'provider':'payme','idempotencyKey':str(uuid4())})


@pytest.mark.asyncio
@pytest.mark.parametrize('amount',[0,-1,1.5,True,2**63,'150000'])
async def test_amount_zero_negative_float_boolean_overflow_rejected(family,amount):
    _,client,actors,_=family
    await request(client,actors['student'],'POST','/api/finance/me/intents',422,
                  json={'amountMinor':amount,'provider':'payme','idempotencyKey':str(uuid4())})


@pytest.fixture
def payme_config(monkeypatch):
    import base64
    for key,value in {'PAYME_LIVE_VERIFIED':'1','PAYME_MERCHANT_ID':'isolated-merchant',
        'PAYME_KEY':'isolated-not-a-live-key','PAYME_LOGIN':'Paycom','PAYMENTS_RETURN_ORIGIN':'https://journey.test'}.items():
        monkeypatch.setenv(key,value)
    return 'Basic '+base64.b64encode(b'Paycom:isolated-not-a-live-key').decode()


async def new_intent(client,actor,path='/api/finance/me/intents',**values):
    return await request(client,actor,'POST',path,json={'amountMinor':150000,'provider':'payme','idempotencyKey':str(uuid4()),**values})


async def rpc(client,auth,method,params):
    response=await client.post('/api/payments/callbacks/payme',headers={'authorization':auth},json={'id':1,'method':method,'params':params})
    assert response.status_code==200,response.text
    return response.json()


async def pay(client,auth,intent,tx='isolated-provider-tx',*,perform=True):
    from datetime import datetime,timezone
    result=await rpc(client,auth,'CreateTransaction',{'id':tx,'time':int(datetime.now(timezone.utc).timestamp()*1000),
        'amount':intent['amountMinor']*100,'account':{'order_id':intent['intentId']}})
    assert result['result']['state']==1,result
    if perform:
        settled=await rpc(client,auth,'PerformTransaction',{'id':tx})
        assert settled['result']['state']==2,settled
        return settled
    return result


@pytest.mark.asyncio
async def test_guardian_can_pay_only_linked_child(family,payme_config):
    _,client,a,_=family
    intent=await new_intent(client,a['guardian'],child_path(a)+'/intents')
    await pay(client,payme_config,intent)
    assert (await request(client,a['guardian'],'GET',child_path(a)))['position']['balanceDueMinor']==750000
    await request(client,a['other_guardian'],'GET',child_path(a)+'/intents/'+intent['intentId'],403)
    await request(client,a['guardian'],'POST',child_path(a,'outsider')+'/intents',403,
                  json={'amountMinor':1,'provider':'payme','idempotencyKey':str(uuid4())})


@pytest.mark.asyncio
async def test_guardian_two_children_payment_uses_exact_beneficiary(family,payme_config):
    _,client,a,_=family
    intent=await new_intent(client,a['guardian'],child_path(a)+'/intents')
    await request(client,a['guardian'],'GET',child_path(a,'second'))
    await pay(client,payme_config,intent)
    assert (await request(client,a['guardian'],'GET',child_path(a)))['position']['balanceDueMinor']==750000
    assert (await request(client,a['guardian'],'GET',child_path(a,'second')))['position']['balanceDueMinor']==300000
    await request(client,a['guardian'],'GET',child_path(a,'second')+'/intents/'+intent['intentId'],404)


@pytest.mark.asyncio
async def test_student_can_enter_unrestricted_policy_valid_custom_amount(family,payme_config):
    _,client,a,_=family
    intent=await new_intent(client,a['student'],amountMinor=137531)
    await pay(client,payme_config,intent)
    assert (await request(client,a['student'],'GET','/api/finance/me/payments'))['position']['balanceDueMinor']==762469


@pytest.mark.asyncio
async def test_amount_below_provider_minimum_explained(family,payme_config,monkeypatch):
    _,client,a,_=family
    monkeypatch.setenv('PAYME_MIN_UZS','1000')
    result=await request(client,a['student'],'POST','/api/finance/me/intents',422,
        json={'amountMinor':999,'provider':'payme','idempotencyKey':str(uuid4())})
    assert result=={'error':'provider_minimum','minimumMinor':1000}


@pytest.mark.asyncio
async def test_payment_intent_duplicate_submit_returns_one_intent(family,payme_config):
    import asyncio
    conn,client,a,_=family
    key=str(uuid4())
    first,second=await asyncio.gather(new_intent(client,a['student'],idempotencyKey=key),new_intent(client,a['student'],idempotencyKey=key))
    assert first['intentId']==second['intentId'] and await conn.fetchval('SELECT count(*) FROM tuition_payment_intents')==1
    await request(client,a['student'],'POST','/api/finance/me/intents',409,json={'amountMinor':150001,'provider':'payme','idempotencyKey':key})


@pytest.mark.asyncio
async def test_browser_redirect_does_not_mark_paid(family,payme_config):
    conn,client,a,_=family
    intent=await new_intent(client,a['student'])
    result=await request(client,a['student'],'GET','/api/finance/me/intents/'+intent['intentId']+'?paid=true&status=success')
    assert result['status']=='created' and result['acknowledgement'] is None
    assert await conn.fetchval('SELECT count(*) FROM tuition_payments')==0


@pytest.mark.asyncio
async def test_provider_callback_signature_required(family,payme_config):
    conn,client,a,_=family
    intent=await new_intent(client,a['student'])
    result=await rpc(client,'Basic wrong','CreateTransaction',{'id':'forged','time':1,'amount':15000000,'account':{'order_id':intent['intentId']}})
    assert result['error']['code']==-32504 and await conn.fetchval('SELECT count(*) FROM tuition_payments')==0


@pytest.mark.asyncio
async def test_provider_amount_currency_student_order_exact(family,payme_config):
    conn,client,a,_=family
    intent=await new_intent(client,a['student'])
    for amount,order,code in ((15000001,intent['intentId'],-31001),(15000000,str(uuid4()),-31050)):
        result=await rpc(client,payme_config,'CreateTransaction',{'id':'wrong','time':1,'amount':amount,'account':{'order_id':order}})
        assert result['error']['code']==code
    await request(client,a['student'],'POST','/api/finance/me/intents',422,json={'amountMinor':150000,'currency':'USD','provider':'payme','idempotencyKey':str(uuid4())})
    assert await conn.fetchval('SELECT count(*) FROM tuition_payments')==0


@pytest.mark.asyncio
async def test_callback_replay_one_journal_effect(family,payme_config):
    import asyncio
    conn,client,a,_=family
    intent=await new_intent(client,a['student'])
    await pay(client,payme_config,intent)
    original=await conn.fetchval('SELECT count(*) FROM finance_journal_entries')
    replies=await asyncio.gather(*(rpc(client,payme_config,'PerformTransaction',{'id':'isolated-provider-tx'}) for _ in range(8)))
    assert all(r['result']['state']==2 for r in replies)
    assert await conn.fetchval('SELECT count(*) FROM finance_journal_entries')==original
    assert await conn.fetchval('SELECT count(*) FROM tuition_payments')==1
    assert await conn.fetchval('SELECT count(*) FROM tuition_provider_events')==1


@pytest.mark.asyncio
async def test_out_of_order_callback_does_not_reopen_cancelled_money(family,payme_config):
    conn,client,a,_=family
    intent=await new_intent(client,a['student'])
    await pay(client,payme_config,intent,tx='cancelled-tx',perform=False)
    cancelled=await rpc(client,payme_config,'CancelTransaction',{'id':'cancelled-tx','reason':1})
    assert cancelled['result']['state']==-1
    rejected=await rpc(client,payme_config,'PerformTransaction',{'id':'cancelled-tx'})
    assert rejected['error']['code']==-31008
    assert await conn.fetchval("SELECT count(*) FROM tuition_payments WHERE status='confirmed'")==0


@pytest.mark.asyncio
async def test_provider_timeout_status_pending_then_confirmed(family,payme_config):
    _,client,a,_=family
    intent=await new_intent(client,a['student'])
    await pay(client,payme_config,intent,tx='delayed',perform=False)
    assert (await request(client,a['student'],'GET','/api/finance/me/intents/'+intent['intentId']))['status']=='pending'
    await rpc(client,payme_config,'PerformTransaction',{'id':'delayed'})
    assert (await request(client,a['student'],'GET','/api/finance/me/intents/'+intent['intentId']))['status']=='paid'


@pytest.mark.asyncio
async def test_overpayment_is_an_advance(family,payme_config):
    _,client,a,_=family
    intent=await new_intent(client,a['guardian'],child_path(a,'second')+'/intents',amountMinor=500000)
    await pay(client,payme_config,intent)
    p=(await request(client,a['guardian'],'GET',child_path(a,'second')))['position']
    assert (p['collectedMinor'],p['allocatedMinor'],p['balanceDueMinor'],p['advanceMinor'])==(500000,300000,0,200000)


@pytest.mark.asyncio
async def test_payment_history_persists_after_refresh(family,payme_config):
    _,client,a,_=family
    intent=await new_intent(client,a['student'])
    await pay(client,payme_config,intent)
    for _ in range(2):
        data=await request(client,a['student'],'GET','/api/finance/me/payments?limit=1')
        assert data['history'][0]['intentId']==intent['intentId'] and data['history'][0]['status']=='paid'
    assert not (await request(client,a['student'],'GET','/api/finance/me/payments?offset=1'))['history']


@pytest.mark.asyncio
async def test_fiscal_receipt_not_claimed_without_verified_fiscalization(family,payme_config):
    _,client,a,_=family
    intent=await new_intent(client,a['student'])
    await pay(client,payme_config,intent)
    result=await request(client,a['student'],'GET','/api/finance/me/intents/'+intent['intentId'])
    assert result['acknowledgement']['kind']=='internal'
    assert result['fiscalStatus']=='manual_review' and result['fiscalReceiptUrl'] is None


@pytest.mark.asyncio
async def test_billing_mode_monthly_does_not_show_fabricated_days(family,payme_config):
    _,client,a,_=family
    result=await request(client,a['student'],'GET','/api/finance/me/payments')
    assert result['billingPolicy']=={'mode':'MONTHLY_INVOICE','version':'monthly-invoice-v1','advanceUse':'money_on_account'}
    assert not any(k in str(result) for k in ('daysLeft','lessonsLeft','dailyPrice'))


@pytest.mark.asyncio
async def test_unconfirmed_refund_does_not_reduce_advance(family,payme_config):
    conn,client,a,_=family
    intent=await new_intent(client,a['guardian'],child_path(a,'second')+'/intents',amountMinor=500000)
    await pay(client,payme_config,intent)
    payment=await conn.fetchval('SELECT payment_id FROM tuition_payment_intents WHERE id=$1',UUID(intent['intentId']))
    refund,_=await ledger.request_refund(conn,actor_user_id=a['admin']['id'],payment_id=payment,amount_minor=100000,reason='Isolated refund',method='bank')
    await ledger.approve_refund(conn,actor_user_id=a['owner']['id'],refund_id=refund['id'])
    assert (await ledger.student_position(conn,a['second']['id']))['advanceMinor']==200000


@pytest.mark.asyncio
async def test_partial_refund_preserves_remaining_advance(family,payme_config):
    from uuid import UUID
    conn,client,a,_=family
    intent=await new_intent(client,a['guardian'],child_path(a,'second')+'/intents',amountMinor=500000)
    await pay(client,payme_config,intent)
    payment=await conn.fetchval('SELECT payment_id FROM tuition_payment_intents WHERE id=$1',UUID(intent['intentId']))
    refund,_=await ledger.request_refund(conn,actor_user_id=a['admin']['id'],payment_id=payment,amount_minor=100000,reason='Isolated refund',method='bank')
    await ledger.approve_refund(conn,actor_user_id=a['owner']['id'],refund_id=refund['id'])
    await ledger.settle_refund(conn,actor_user_id=a['admin']['id'],refund_id=refund['id'])
    assert (await ledger.student_position(conn,a['second']['id']))['advanceMinor']==100000
    result=await request(client,a['guardian'],'GET',child_path(a,'second')+'/intents/'+intent['intentId'])
    assert result['status']=='partially_refunded' and result['advanceMinor']==100000


@pytest.mark.asyncio
async def test_credit_note_reduces_payment_allocation_ceiling(family,payme_config):
    conn,client,a,_=family
    charge=await conn.fetchval('SELECT id FROM tuition_charges WHERE student_user_id=$1',a['second']['id'])
    note=await ledger.create_credit_note(conn,actor_user_id=a['admin']['id'],charge_id=charge,amount_minor=100000,reason='Isolated relief')
    await ledger.approve_credit_note(conn,actor_user_id=a['owner']['id'],credit_note_id=note['id'])
    await ledger.post_credit_note(conn,actor_user_id=a['admin']['id'],credit_note_id=note['id'])
    intent=await new_intent(client,a['guardian'],child_path(a,'second')+'/intents',amountMinor=300000)
    await pay(client,payme_config,intent)
    p=await ledger.student_position(conn,a['second']['id'])
    assert (p['allocatedMinor'],p['advanceMinor'],p['balanceDueMinor'])==(200000,100000,0)


def test_business_date_boundary_tashkent_midnight():
    from datetime import datetime,timezone
    assert ledger.business_date(datetime(2026,11,15,18,59,59,tzinfo=timezone.utc)).isoformat()=='2026-11-15'
    assert ledger.business_date(datetime(2026,11,15,19,0,0,tzinfo=timezone.utc)).isoformat()=='2026-11-16'


@pytest.mark.asyncio
async def test_revoked_parent_cannot_read_prepared_order_but_original_child_receives_verified_funds(family,payme_config):
    conn,client,a,links=family
    intent=await new_intent(client,a['guardian'],child_path(a)+'/intents')
    await pay(client,payme_config,intent,perform=False)
    await conn.execute("UPDATE guardian_links SET status='revoked',revoked_at=now() WHERE id=$1",links['student'])
    await request(client,a['guardian'],'GET',child_path(a)+'/intents/'+intent['intentId'],403)
    assert (await rpc(client,payme_config,'PerformTransaction',{'id':'isolated-provider-tx'}))['result']['state']==2
    assert (await ledger.student_position(conn,a['student']['id']))['collectedMinor']==150000
    assert (await ledger.student_position(conn,a['second']['id']))['collectedMinor']==0


@pytest.mark.asyncio
async def test_cash_payment_history_is_retained(family):
    conn,client,a,_=family
    await ledger.record_payment(conn,actor_user_id=a['admin']['id'],student_user_id=a['student']['id'],amount_minor=100000,payer_name='QA parent',idempotency_key='old-cash')
    result=await request(client,a['student'],'GET','/api/finance/me/payments')
    assert result['history'][0]['provider']=='cash' and result['history'][0]['amountMinor']==100000
    assert result['history'][0]['acknowledgement']['kind']=='internal'


@pytest.mark.asyncio
@pytest.mark.parametrize('journey',['20261115'],indirect=True)
async def test_payment_feature_upgrade_is_atomic_idempotent_and_preserves_existing_rows(journey):
    import asyncpg
    from migrate_self_service_payments import upgrade
    conn,_=journey
    user=await create_actor(conn,'Existing payer','student')
    plan=await upgrade(conn)
    assert plan['pending'] and not plan['applied']
    await conn.execute('ALTER FUNCTION finance_journal_immutable_guard() RENAME TO held_immutable_guard')
    with pytest.raises(asyncpg.UndefinedFunctionError):await upgrade(conn,apply=True)
    assert await conn.fetchval("SELECT to_regclass('public.tuition_payment_intents')") is None
    assert await conn.fetchval("SELECT to_regclass('la_payments_migrations.applied')") is None
    await conn.execute('ALTER FUNCTION held_immutable_guard() RENAME TO finance_journal_immutable_guard')
    assert (await upgrade(conn,apply=True))['applied']
    assert not (await upgrade(conn,apply=True))['pending']
    assert await conn.fetchval('SELECT name FROM users WHERE id=$1',user['id'])=='Existing payer'
    assert await conn.fetchval("SELECT count(*) FROM pg_class WHERE relname=ANY($1::text[]) AND relrowsecurity",['tuition_payment_intents','tuition_provider_events'])==2


@pytest.mark.asyncio
async def test_payment_quotes_cannot_be_reassigned_or_deleted(family,payme_config):
    import asyncpg
    conn,client,a,_=family
    intent=await new_intent(client,a['student'])
    for sql,value in [('UPDATE tuition_payment_intents SET amount_minor=$2 WHERE id=$1',1),
                      ('UPDATE tuition_payment_intents SET student_user_id=$2 WHERE id=$1',a['second']['id'])]:
        async with conn.transaction():
            with pytest.raises(asyncpg.RaiseError,match='immutable'):
                async with conn.transaction():await conn.execute(sql,UUID(intent['intentId']),value)
    with pytest.raises(asyncpg.RaiseError,match='durable'):
        async with conn.transaction():await conn.execute('DELETE FROM tuition_payment_intents WHERE id=$1',UUID(intent['intentId']))


@pytest.mark.asyncio
async def test_click_official_prepare_complete_signature_and_duplicate(family,monkeypatch):
    import hashlib
    conn,client,a,_=family
    for key,value in {'CLICK_LIVE_VERIFIED':'1','CLICK_SERVICE_ID':'123','CLICK_MERCHANT_ID':'456',
                      'CLICK_SECRET_KEY':'isolated-click-key','PAYMENTS_RETURN_ORIGIN':'https://journey.test'}.items():monkeypatch.setenv(key,value)
    intent=await new_intent(client,a['student'],provider='click')
    data={'click_trans_id':'7001','service_id':'123','merchant_trans_id':intent['intentId'],
          'amount':'150000.00','action':'0','sign_time':'2026-11-15 20:00:00','error':'0'}
    def signed(payload):
        value=payload['click_trans_id']+payload['service_id']+'isolated-click-key'+payload['merchant_trans_id']
        if payload['action']=='1':value+=payload['merchant_prepare_id']
        value+=payload['amount']+payload['action']+payload['sign_time']
        return {**payload,'sign_string':hashlib.md5(value.encode(),usedforsecurity=False).hexdigest()}
    invalid=await client.post('/api/payments/callbacks/click',data={**data,'sign_string':'0'*32})
    assert invalid.json()['error']==-1
    prepared=(await client.post('/api/payments/callbacks/click',data=signed(data))).json()
    assert prepared['error']==0,prepared
    data.update(action='1',merchant_prepare_id=str(prepared['merchant_prepare_id']))
    for _ in range(2):assert (await client.post('/api/payments/callbacks/click',data=signed(data))).json()['error']==0
    assert (await ledger.student_position(conn,a['student']['id']))['collectedMinor']==150000
    assert await conn.fetchval('SELECT count(*) FROM tuition_provider_events')==1


@pytest.mark.asyncio
async def test_uzum_unauthenticated_wakeup_requires_authenticated_exact_status(family,monkeypatch):
    from app import payment_providers as vendors
    conn,client,a,_=family
    for key,value in {'UZUM_LIVE_VERIFIED':'1','UZUM_TERMINAL_ID':str(uuid4()),'UZUM_API_KEY':'isolated-uzum-key',
        'UZUM_BASE_URL':'https://isolated.uzumbank.uz','UZUM_CHECKOUT_ORIGIN':'https://checkout.uzumbank.uz',
        'PAYMENTS_RETURN_ORIGIN':'https://journey.test'}.items():monkeypatch.setenv(key,value)
    vendor=str(uuid4());order=None;wrong=True
    async def transport(config,path,body):
        nonlocal order
        if path.endswith('/register'):
            order=body['orderNumber'];assert body['amount']==15000000 and body['currency']==860
            return {'orderId':vendor,'paymentRedirectUrl':'https://checkout.uzumbank.uz/isolated'}
        return {'orderId':vendor,'merchantOrderId':order,'status':'COMPLETED','amount':15000001 if wrong else 15000000,
                'completedAmount':15000000,'refundedAmount':0,'reversedAmount':0}
    monkeypatch.setattr(vendors,'uzum_request',transport)
    intent=await new_intent(client,a['student'],provider='uzum')
    body={'orderId':vendor,'orderNumber':intent['intentId'],'operationState':'SUCCESS','operationType':'PAYMENT'}
    response=await client.post('/api/payments/callbacks/uzum',json=body)
    assert response.status_code==409
    assert (await ledger.student_position(conn,a['student']['id']))['collectedMinor']==0
    wrong=False
    for _ in range(2):assert (await client.post('/api/payments/callbacks/uzum',json=body)).status_code==200
    assert (await ledger.student_position(conn,a['student']['id']))['collectedMinor']==150000


@pytest.mark.asyncio
async def test_reconciliation_equals_independent_journal(family,payme_config):
    conn,client,a,_=family
    intent=await new_intent(client,a['guardian'],child_path(a,'second')+'/intents',amountMinor=500000)
    await pay(client,payme_config,intent)
    day=ledger.business_date(ledger.datetime.now(ledger.timezone.utc))
    assert (await ledger.reconcile_summary(conn,start=day,end=day))['ok']
    rows=await conn.fetch('''SELECT a.code,l.direction,sum(l.amount_minor)::bigint AS amount
        FROM finance_journal_lines l JOIN finance_accounts a ON a.id=l.account_id
        JOIN finance_journal_entries e ON e.id=l.entry_id WHERE e.source_type='provider_payment'
        GROUP BY a.code,l.direction''')
    # Compare independently selected journal postings with the known 300k obligation.
    result={(r['code'],r['direction']):r['amount'] for r in rows}
    assert result=={('provider_clearing','debit'):500000,('accounts_receivable','credit'):300000,('customer_advance','credit'):200000}


@pytest.mark.asyncio
async def test_uzum_status_recovery_is_bounded_and_never_invents_money(family,monkeypatch):
    from app import main,payment_providers as vendors,payment_reconciliation as recovery
    conn,client,a,_=family
    for key,value in {'UZUM_LIVE_VERIFIED':'1','UZUM_TERMINAL_ID':str(uuid4()),'UZUM_API_KEY':'isolated-uzum-key',
        'UZUM_BASE_URL':'https://isolated.uzumbank.uz','UZUM_CHECKOUT_ORIGIN':'https://checkout.uzumbank.uz',
        'PAYMENTS_RETURN_ORIGIN':'https://journey.test','PAYMENT_RECONCILIATION_ENABLED':'1'}.items():monkeypatch.setenv(key,value)
    vendor=str(uuid4())
    async def transport(config,path,body):
        if path.endswith('/register'):return {'orderId':vendor,'paymentRedirectUrl':'https://checkout.uzumbank.uz/isolated'}
        raise ledger.LedgerError('provider_temporarily_unavailable',503)
    monkeypatch.setattr(vendors,'uzum_request',transport)
    intent=await new_intent(client,a['student'],provider='uzum')
    pool=await main.pool()
    for _ in range(12):
        await conn.execute('UPDATE tuition_payment_intents SET next_check_at=now() WHERE id=$1',UUID(intent['intentId']))
        result=await recovery.reconcile_batch(pool)
        assert result['checked']==1 and result['failed']==1
    assert (await recovery.reconcile_batch(pool))['checked']==0
    assert await conn.fetchval('SELECT verification_attempts FROM tuition_payment_intents')==12
    assert await conn.fetchval('SELECT count(*) FROM tuition_payments')==0
