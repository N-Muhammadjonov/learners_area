"""Configurable tariffs and confirmed-cash service accounting on real PostgreSQL."""
from datetime import date,datetime,timedelta,timezone
from fractions import Fraction
from math import ceil
from uuid import UUID,uuid4

import asyncpg
import pytest

from app import prepaid_services as service,tuition_ledger as ledger
from test_academy_learning_journey import journey,request,API
from test_self_service_payments import family,payme_config,new_intent,pay,rpc,child_path


async def policy(family,monkeypatch,**overrides):
    conn,client,a,_=family
    monkeypatch.setenv('PREPAID_BILLING_ENABLED','1')
    course=await conn.fetchval("INSERT INTO courses(slug,title) VALUES($1,'Configured service') RETURNING id",'service-'+uuid4().hex)
    day=ledger.business_date(datetime.now(timezone.utc))
    body={'id':str(uuid4()),'studentUserId':str(a['student']['id']),'courseId':str(course),
        'mode':'PREPAID_CALENDAR_DAYS','label':'Chosen tariff','priceAmountMinor':26500,'priceUnits':1,
        'maxUnits':366,'startsOn':str(day-timedelta(days=40)),'endsOn':str(day+timedelta(days=100)),
        'eligibleWeekdays':list(range(7)),'excludedDates':[],
        'residualRule':'carry_money_without_expiry','lessonBasis':'held_session_roster',**overrides}
    p=await request(client,a['admin'],'POST','/api/staff/finance/service-policies',json=body)
    await request(client,a['owner'],'POST',f"/api/staff/finance/contracts/{p['contract_id']}/approve")
    await request(client,a['admin'],'POST',f"/api/staff/finance/contracts/{p['contract_id']}/activate")
    return p,body


async def account(client,a):
    data=await request(client,a['student'],'GET','/api/finance/me/payments')
    return data['serviceAccounts'][0],data['position']


@pytest.mark.parametrize('amount,units',[(200000,7),(350000,12),(137531,19),(26500,1),(31,29),(7,7)])
def test_arbitrary_ratio_conserves_exact_bundle_without_float_rounding(amount,units):
    p={'price_amount_minor':amount,'price_units':units,'max_units':3660}
    for consumed in (0,1,units-1,units*2+3):
        charges=[service.cost_for_units(p,consumed+i,1) for i in range(units)]
        assert sum(charges)==amount and min(charges)>0
        for cash in (0,amount-1,amount,amount*2+1):
            n,remainder=service.affordable_units(p,consumed,cash)
            expected=max(i for i in range(3*units+1) if ceil(Fraction((consumed+i)*amount,units))-ceil(Fraction(consumed*amount,units))<=cash)
            assert n==expected and remainder==cash-sum(service.cost_for_units(p,consumed+j,1) for j in range(n))


@pytest.mark.asyncio
async def test_confirmed_policy_funds_are_isolated_from_monthly_debt_and_replay(family,monkeypatch,payme_config):
    conn,client,a,_=family
    p,_=await policy(family,monkeypatch)
    intent=await new_intent(client,a['guardian'],child_path(a)+'/intents',amountMinor=200000,servicePolicyId=p['id'])
    assert intent['quoteVersion']=='svc1:'+p['id']
    assert (await account(client,a))[0]['remainingUnits']==0
    await pay(client,payme_config,intent)
    value,position=await account(client,a)
    assert (value['remainingUnits'],value['unappliedCreditMinor'],value['unspentMinor'])==(7,14500,200000)
    assert position['balanceDueMinor']==900000 and position['allocatedMinor']==0
    await rpc(client,payme_config,'PerformTransaction',{'id':'isolated-provider-tx'})
    assert await conn.fetchval('SELECT count(*) FROM tuition_service_events')==1
    assert await conn.fetchval("SELECT count(*) FROM finance_journal_entries WHERE source_type='provider_payment'")==1
    monkeypatch.setenv('PREPAID_BILLING_ENABLED','0')
    assert (await account(client,a))[0]['remainingUnits']==7
    await request(client,a['student'],'POST','/api/finance/me/intents',409,
        json={'amountMinor':1,'provider':'payme','idempotencyKey':str(uuid4()),'servicePolicyId':p['id']})


@pytest.mark.asyncio
async def test_seven_days_configured_bundle_consumes_exact_total_once(family,monkeypatch,payme_config):
    conn,client,a,_=family
    p,_=await policy(family,monkeypatch,priceAmountMinor=200000,priceUnits=7)
    intent=await new_intent(client,a['student'],amountMinor=200000,servicePolicyId=p['id'])
    await pay(client,payme_config,intent)
    day=ledger.business_date(datetime.now(timezone.utc))
    charges=[]
    for offset in range(1,8):
        body={'serviceDate':str(day-timedelta(days=offset))}
        route=f"/api/staff/finance/service-policies/{p['id']}/days"
        charge=await request(client,a['admin'],'POST',route,json=body)
        assert (await request(client,a['admin'],'POST',route,json=body))['duplicate']
        charges.append(charge['amountMinor'])
    assert sum(charges)==200000 and set(charges)=={28571,28572}
    value,position=await account(client,a)
    assert (value['remainingUnits'],value['unappliedCreditMinor'],value['unspentMinor'],value['consumedUnits'])==(0,0,0,7)
    assert position['balanceDueMinor']==900000 and position['allocatedMinor']==200000
    assert await conn.fetchval('SELECT count(*) FROM tuition_service_consumptions')==7
    assert not await conn.fetchval("""SELECT EXISTS(SELECT transaction_id FROM finance_journal_lines GROUP BY transaction_id
        HAVING sum(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END)<>0)""")


@pytest.mark.asyncio
async def test_refund_approval_does_not_remove_units_settlement_does(family,monkeypatch,payme_config):
    conn,client,a,_=family
    p,_=await policy(family,monkeypatch)
    intent=await new_intent(client,a['student'],amountMinor=200000,servicePolicyId=p['id'])
    await pay(client,payme_config,intent)
    payment=await conn.fetchval('SELECT payment_id FROM tuition_payment_intents WHERE id=$1',UUID(intent['intentId']))
    refund,_=await ledger.request_refund(conn,actor_user_id=a['admin']['id'],payment_id=payment,amount_minor=50000,reason='Returned unused funds',method='bank')
    await ledger.approve_refund(conn,actor_user_id=a['owner']['id'],refund_id=refund['id'])
    assert (await account(client,a))[0]['remainingUnits']==7
    await ledger.settle_refund(conn,actor_user_id=a['admin']['id'],refund_id=refund['id'])
    value,_=await account(client,a)
    assert (value['remainingUnits'],value['unappliedCreditMinor'],value['unspentMinor'])==(5,17500,150000)
    assert await conn.fetchval("SELECT count(*) FROM tuition_service_events WHERE reason_type='refund'")==1


@pytest.mark.asyncio
async def test_beneficiary_roles_immutable_terms_and_wrong_mode_are_denied(family,monkeypatch,payme_config):
    conn,client,a,_=family
    p,body=await policy(family,monkeypatch)
    for role in ('student','guardian','teacher'):
        await request(client,a[role],'POST','/api/staff/finance/service-policies',403,json=body)
        await request(client,a[role],'GET',f"/api/staff/finance/students/{a['student']['id']}/service-policies",403)
    await request(client,a['second'],'POST','/api/finance/me/intents',403,
        json={'amountMinor':1,'provider':'payme','idempotencyKey':str(uuid4()),'servicePolicyId':p['id']})
    with pytest.raises(asyncpg.RaiseError,match='terms_are_immutable'):
        await conn.execute('UPDATE tuition_service_policies SET price_amount_minor=12345 WHERE id=$1',UUID(p['id']))
    await request(client,a['admin'],'POST',f"/api/staff/finance/service-policies/{p['id']}/days",422,
        json={'serviceDate':str(date.today()+timedelta(days=2))})
    await conn.execute("UPDATE users SET account_status='suspended' WHERE id=$1",a['student']['id'])
    await request(client,a['admin'],'POST','/api/staff/finance/payments',409,
        json={'studentUserId':str(a['student']['id']),'amountMinor':100000,'method':'cash','idempotencyKey':str(uuid4()),'servicePolicyId':p['id']})


def test_calendar_month_lengths_holidays_pauses_and_consumed_today():
    p={'mode':'PREPAID_CALENDAR_DAYS','starts_on':date(2028,2,27),'ends_on':date(2028,3,31),
       'eligible_weekdays':[0,1,2,3,4],'excluded_dates':[date(2028,3,1)]}
    pauses=[{'starts_on':date(2028,3,2),'ends_on':date(2028,3,3)}]
    assert service.coverage(p,3,date(2028,2,27),pauses)==(3,date(2028,3,6))
    assert service.coverage(p,2,date(2028,2,29),pauses,{date(2028,2,29)})==(2,date(2028,3,7))


@pytest.mark.asyncio
async def test_held_lesson_deducts_once_attendance_edits_never_charge(family,monkeypatch,payme_config):
    conn,client,a,_=family
    p,body=await policy(family,monkeypatch,mode='PREPAID_LESSONS',priceAmountMinor=50000)
    intent=await new_intent(client,a['student'],amountMinor=150000,servicePolicyId=p['id'])
    await pay(client,payme_config,intent)
    day=ledger.business_date(datetime.now(timezone.utc))
    group=await request(client,a['owner'],'POST',API+'/groups',201,json={
        'id':str(uuid4()),'name':'Configured lessons','courseId':body['courseId'],'teacherIds':[str(a['teacher']['id'])],
        'branch':'QA','room':'P1','capacity':10,'startsOn':str(day-timedelta(days=2)),'status':'active'})
    path=API+'/groups/'+group['id']
    await request(client,a['owner'],'POST',path+'/memberships',201,json={'studentId':str(a['student']['id'])})
    sessions=await request(client,a['owner'],'POST',path+'/sessions',201,json={
        'seriesId':str(uuid4()),'room':'P1','localDate':str(day),'localStart':'00:00','durationMinutes':15})
    route=path+'/sessions/'+sessions['sessions'][0]['id']
    await request(client,a['owner'],'PUT',route,json={'status':'held','revision':1})
    await request(client,a['owner'],'PUT',route,json={'status':'held','revision':1})
    await request(client,a['owner'],'PUT',route+'/attendance',json={
        'id':str(uuid4()),'marks':[{'studentId':str(a['student']['id']),'revision':1,'status':'present'}]})
    value,_=await account(client,a)
    assert (value['remainingUnits'],value['unspentMinor'],value['consumedUnits'])==(2,100000,1)
    assert await conn.fetchval('SELECT count(*) FROM tuition_service_consumptions')==1
    await request(client,a['admin'],'POST',f"/api/staff/finance/service-policies/{p['id']}/days",422,json={'serviceDate':str(day)})


@pytest.mark.asyncio
async def test_pause_changes_covered_dates_but_never_erases_money(family,monkeypatch,payme_config):
    conn,client,a,_=family
    p,_=await policy(family,monkeypatch)
    intent=await new_intent(client,a['student'],amountMinor=200000,servicePolicyId=p['id'])
    await pay(client,payme_config,intent)
    day=ledger.business_date(datetime.now(timezone.utc))
    path=f"/api/staff/finance/service-policies/{p['id']}/pauses"
    body={'id':str(uuid4()),'startsOn':str(day),'endsOn':str(day+timedelta(days=2)),'reason':'Approved absence'}
    pause=await request(client,a['admin'],'POST',path,json=body)
    before,_=await account(client,a)
    await request(client,a['admin'],'POST',path+'/'+pause['id']+'/approve',403)
    await request(client,a['owner'],'POST',path+'/'+pause['id']+'/approve')
    after,_=await account(client,a)
    assert after['remainingUnits']==before['remainingUnits']==7
    assert after['unspentMinor']==before['unspentMinor']==200000
    assert date.fromisoformat(after['coveredUntil'])==date.fromisoformat(before['coveredUntil'])+timedelta(days=3)
    with pytest.raises(asyncpg.RaiseError,match='service_pause_is_durable'):
        await conn.execute('DELETE FROM tuition_service_pauses WHERE id=$1',UUID(pause['id']))


@pytest.mark.asyncio
@pytest.mark.parametrize('journey',['20261116'],indirect=True)
async def test_prepaid_migration_atomic_replay_and_existing_money_preserved(journey):
    from migrate_prepaid_services import upgrade
    from test_academy_learning_journey import create_actor
    conn,_=journey
    admin=await create_actor(conn,'Existing cashier','admin')
    student=await create_actor(conn,'Existing pupil','student')
    payment,_,_=await ledger.record_payment(conn,actor_user_id=admin['id'],student_user_id=student['id'],amount_minor=137531,idempotency_key='prior-money')
    assert (await upgrade(conn))['pending']
    await conn.execute('ALTER FUNCTION finance_journal_immutable_guard() RENAME TO held_immutable_guard')
    with pytest.raises(asyncpg.UndefinedFunctionError):await upgrade(conn,apply=True)
    assert await conn.fetchval("SELECT to_regclass('public.tuition_service_policies')") is None
    assert await conn.fetchval("SELECT to_regclass('la_prepaid_migrations.applied')") is None
    await conn.execute('ALTER FUNCTION held_immutable_guard() RENAME TO finance_journal_immutable_guard')
    assert (await upgrade(conn,apply=True))['applied']
    assert not (await upgrade(conn,apply=True))['pending']
    assert (await conn.fetchrow('SELECT * FROM tuition_payments WHERE id=$1',payment['id']))['service_policy_id'] is None
    assert (await ledger.student_position(conn,student['id']))['advanceMinor']==137531
    assert await conn.fetchval("SELECT count(*) FROM pg_class WHERE relname LIKE 'tuition_service_%' AND relkind='r' AND relrowsecurity")==4


@pytest.mark.asyncio
async def test_reserved_refund_cannot_be_double_spent_on_delivered_service(family,monkeypatch,payme_config):
    conn,client,a,_=family
    p,_=await policy(family,monkeypatch,priceAmountMinor=50000)
    intent=await new_intent(client,a['student'],amountMinor=100000,servicePolicyId=p['id'])
    await pay(client,payme_config,intent)
    payment=await conn.fetchval('SELECT payment_id FROM tuition_payment_intents WHERE id=$1',UUID(intent['intentId']))
    refund,_=await ledger.request_refund(conn,actor_user_id=a['admin']['id'],payment_id=payment,amount_minor=100000,reason='Reserved return',method='bank')
    day=ledger.business_date(datetime.now(timezone.utc))-timedelta(days=1)
    charged=await request(client,a['admin'],'POST',f"/api/staff/finance/service-policies/{p['id']}/days",json={'serviceDate':str(day)})
    assert charged['allocatedMinor']==0 and charged['balanceDueMinor']==50000
    await ledger.approve_refund(conn,actor_user_id=a['owner']['id'],refund_id=refund['id'])
    await ledger.settle_refund(conn,actor_user_id=a['admin']['id'],refund_id=refund['id'])
    value,_=await account(client,a)
    assert value['unspentMinor']==0 and value['balanceDueMinor']==50000 and value['remainingUnits']==0


@pytest.mark.asyncio
async def test_calendar_worker_is_bounded_dry_run_and_replay_safe(family,monkeypatch,payme_config):
    from prepaid_calendar import consume_range
    conn,client,a,_=family
    p,_=await policy(family,monkeypatch,priceAmountMinor=350000,priceUnits=12)
    intent=await new_intent(client,a['student'],amountMinor=350000,servicePolicyId=p['id'])
    await pay(client,payme_config,intent)
    yesterday=ledger.business_date(datetime.now(timezone.utc))-timedelta(days=1)
    options={'actor':a['admin']['id'],'policy_id':UUID(p['id']),
        'starts_on':yesterday-timedelta(days=2),'ends_on':yesterday}
    assert len((await consume_range(conn,**options))['eligibleDates'])==3
    assert await conn.fetchval('SELECT count(*) FROM tuition_service_consumptions')==0
    first=await consume_range(conn,**options,apply=True)
    assert sum(r['amountMinor'] for r in first['results'])==87500
    repeat=await consume_range(conn,**options,apply=True)
    assert all(r['duplicate'] for r in repeat['results'])
    assert await conn.fetchval('SELECT count(*) FROM tuition_service_consumptions')==3
    assert (await account(client,a))[0]['unspentMinor']==262500
    with pytest.raises(ledger.LedgerError,match='service_batch_dates_invalid'):
        await consume_range(conn,**{**options,'starts_on':yesterday-timedelta(days=31)},apply=True)


@pytest.mark.asyncio
async def test_staff_cash_replay_remains_available_when_new_purchases_disabled(family,monkeypatch):
    conn,client,a,_=family
    p,_=await policy(family,monkeypatch)
    body={'studentUserId':str(a['student']['id']),'amountMinor':200000,'method':'cash',
        'idempotencyKey':str(uuid4()),'servicePolicyId':p['id']}
    first=await request(client,a['admin'],'POST','/api/staff/finance/payments',json=body)
    monkeypatch.setenv('PREPAID_BILLING_ENABLED','0')
    second=await request(client,a['admin'],'POST','/api/staff/finance/payments',json=body)
    assert second['duplicate'] and first['payment']['id']==second['payment']['id']
    assert await conn.fetchval('SELECT count(*) FROM tuition_service_events')==1
    assert (await request(client,a['student'],'GET','/api/finance/me/payments'))['history'][0]['servicePolicyId']==p['id']
    await request(client,a['admin'],'POST','/api/staff/finance/payments',409,json={**body,'idempotencyKey':str(uuid4())})
