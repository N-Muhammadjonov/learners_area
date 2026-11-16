"""Work queues match accounting truth and never grant teacher/guardian finance."""
from uuid import uuid4
import pytest
from app import tuition_ledger as ledger
from test_self_service_payments import family,journey,request


@pytest.mark.asyncio
async def test_debtor_queue_matches_each_authoritative_student_position(family):
    conn,client,a,_=family
    await ledger.record_payment(conn,actor_user_id=a['admin']['id'],student_user_id=a['student']['id'],amount_minor=100000,idempotency_key='workbench-cash')
    result=await request(client,a['owner'],'GET','/api/staff/finance/debtors?limit=1')
    assert result['total']==2 and result['pagination']['hasMore']
    empty=await request(client,a['owner'],'GET','/api/staff/finance/debtors?offset=20')
    assert empty['items']==[] and empty['total']==2
    seen={}
    for offset in (0,1):
        row=(await request(client,a['admin'],'GET','/api/staff/finance/debtors?limit=1&offset='+str(offset)))['items'][0]
        position=await ledger.student_position(conn,__import__('uuid').UUID(row['studentId']))
        assert row['balanceDueMinor']==position['balanceDueMinor']
        assert row['overdueMinor']==position['overdueMinor']
        seen[row['studentId']]=row['balanceDueMinor']
    assert seen=={str(a['student']['id']):800000,str(a['second']['id']):300000}
    assert (await request(client,a['owner'],'GET','/api/staff/finance/debtors?q=unlinked'))['total']==0
    assert (await request(client,a['owner'],'GET','/api/staff/finance/debtors?overdueOnly=true'))['total']==0


@pytest.mark.asyncio
async def test_workbench_role_boundaries_and_teacher_omit_money(family):
    _,client,a,_=family
    for role in ('teacher','student','guardian'):
        await request(client,a[role],'GET','/api/staff/finance/debtors',403)
    for role in ('student','guardian'):
        await request(client,a[role],'GET','/api/staff/academy/today',403)
    teacher=await request(client,a['teacher'],'GET','/api/staff/academy/today')
    assert teacher['scope']=='assigned' and 'balances' not in teacher and 'followUps' not in teacher
    owner=await request(client,a['owner'],'GET','/api/staff/academy/today')
    assert owner['balances']['count']==2 and owner['balances']['href'].endswith('view=debts')


@pytest.mark.asyncio
async def test_debtor_query_treats_sql_as_search_text(family):
    conn,client,a,_=family
    result=await request(client,a['admin'],'GET',"/api/staff/finance/debtors",params={'q':"'; DROP TABLE users;--"})
    assert result['items']==[]
    assert await conn.fetchval('SELECT count(*) FROM users')>=8


@pytest.mark.asyncio
async def test_today_lists_page_all_rows_and_do_not_confuse_empty_page_with_zero_total(family):
    from datetime import timedelta
    _,client,a,_=family
    for n in range(11):
        await request(client,a['admin'],'POST','/api/staff/academy/leads',201,json={
            'id':str(uuid4()),'name':'Follow up '+str(n),'source':'Website','email':f'followup{n}@example.test',
            'followUpAt':(ledger.datetime.now(ledger.timezone.utc)-timedelta(minutes=n+1)).isoformat()})
    first=await request(client,a['admin'],'GET','/api/staff/academy/today')
    assert first['followUps']['count']==11 and len(first['followUps']['items'])==10
    assert first['followUps']['pagination']['hasMore']
    second=await request(client,a['admin'],'GET','/api/staff/academy/today?followupsOffset=10')
    assert second['followUps']['count']==11 and len(second['followUps']['items'])==1
    assert not second['followUps']['pagination']['hasMore']
    assert not {r['id'] for r in first['followUps']['items']}&{r['id'] for r in second['followUps']['items']}
    empty=await request(client,a['owner'],'GET','/api/staff/academy/today?followupsOffset=20')
    assert empty['followUps']['items']==[] and empty['followUps']['count']==11
    assert 'followUps' not in await request(client,a['teacher'],'GET','/api/staff/academy/today?followupsOffset=10')
