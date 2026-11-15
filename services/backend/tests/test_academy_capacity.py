"""Capacity Explorer uses the source timetable without changing academy records."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.academy_groups import today
from app import tuition_ledger as ledger
from test_academy_learning_journey import API, create_actor, journey, request


@pytest.mark.asyncio
async def test_owner_compares_capacity_and_cash_with_exact_money_and_no_writes(journey):
    conn, client = journey
    owner = await create_actor(conn, 'Capacity Owner', 'owner')
    admin = await create_actor(conn, 'Capacity Admin', 'admin')
    teacher = await create_actor(conn, 'Capacity Teacher', 'teacher')
    learner = await create_actor(conn, 'Capacity Learner', 'student')
    course = await conn.fetchval("INSERT INTO courses(slug,title) VALUES('capacity','IELTS B2') RETURNING id")
    group = await request(client, owner, 'POST', API+'/groups', 201, json={
        'id':str(uuid4()), 'courseId':str(course), 'teacherIds':[str(teacher['id'])],
        'name':'Capacity group', 'branch':'Tashkent', 'room':'North', 'capacity':10,
        'startsOn':str(today()), 'status':'active',
    })
    group_path = API+'/groups/'+group['id']
    await request(client, owner, 'POST', group_path+'/memberships', 201, json={'studentId':str(learner['id'])})
    lead_id = uuid4()
    trial_at = datetime.now(timezone.utc)-timedelta(hours=1)
    lead = await request(client, owner, 'POST', API+'/leads', 201, json={
        'id':str(lead_id), 'name':'Prospective Learner', 'source':'Capacity test',
        'email':'capacity-trial@example.test', 'courseId':str(course),
    })
    lead_path = API+'/leads/'+lead['id']
    lead_fields = {'name':lead['name'], 'source':lead['source'], 'email':lead['email'], 'courseId':str(course)}
    for stage in ('contacted','trial_scheduled','trial_completed'):
        lead = await request(client, owner, 'PUT', lead_path, json={
            **lead_fields, 'stage':stage, 'revision':lead['revision'],
            **({'trialAt':trial_at.isoformat()} if stage.startswith('trial_') else {}),
        })
    await request(client, owner, 'POST', lead_path+'/convert', json={
        'revision':lead['revision'], 'studentId':str(learner['id']), 'groupId':group['id'],
    })
    departed = await create_actor(conn, 'Departed Learner', 'student')
    await conn.execute("""
        INSERT INTO academy_group_memberships(group_id,course_id,student_user_id,starts_on,ends_on,status,activated_on)
        VALUES ($1,$2,$3,$4,$4,'withdrawn',$4)
    """, group['id'], course, departed['id'], today())
    slot_date = str(today()+timedelta(days=3))
    await request(client, owner, 'POST', group_path+'/sessions', 201, json={
        'seriesId':str(uuid4()), 'localDate':slot_date, 'localStart':'09:00',
        'durationMinutes':60, 'room':'North',
    })

    charge = await ledger.create_charge(
        conn, actor_user_id=admin['id'], student_user_id=learner['id'],
        period=today().strftime('%Y-%m'), due_date=today(), gross_amount_minor=330001,
    )
    await ledger.approve_charge(conn, actor_user_id=owner['id'], charge_id=charge['id'])
    await ledger.post_charge(conn, actor_user_id=admin['id'], charge_id=charge['id'])

    route = API+'/capacity/'+group['id']
    inputs = {
        'projectedStudents': 8, 'tuitionMinor': '200001', 'discountBps': 1000,
        'collectionBps': 7500, 'cashWithinPeriodBps': 8000, 'deliveryBps': 5000,
        'openingDebtMinor': '100001', 'debtRecoveryBps': 5000,
        'teacherPayMethod': 'hourly', 'teacherRateMinor': '100001',
        'teacherMinutesAvailable': 600,
        'slot': {'localDate':slot_date, 'localStart':'09:30', 'durationMinutes':90, 'room':'North'},
    }
    await request(client, admin, 'GET', route, 403)
    await request(client, teacher, 'POST', route, 403, json=inputs)
    await request(client, learner, 'POST', route, 403, json=inputs)
    empty = await request(client, owner, 'GET', route)
    assert empty['reservedSeats'] == 1 and empty['capacity'] == 10

    before = await conn.fetchrow(
        """SELECT (SELECT count(*) FROM academy_sessions) AS sessions,
                  (SELECT count(*) FROM academy_session_reservations) AS reservations,
                  (SELECT count(*) FROM audit_log) AS audit,
                  (SELECT count(*) FROM finance_journal_entries) AS journal"""
    )
    report = await request(client, owner, 'POST', route, json=inputs)
    assert report['isScenario'] is True
    assert report['academyActuals']['invoicedTuitionMinor'] == '330001'
    assert report['academyActuals']['outstandingReceivableMinor'] == '330001'
    assert report['academyActuals']['recognizedRevenueMinor'] == '0'
    assert report['academyActuals']['overdueReceivableMinor'] == '0'
    assert report['assumptions']['tuitionMinor'] == '200001'
    assert report['schedule']['feasible'] is False
    assert set(report['schedule']['conflicts']) == {'group', 'room', 'teacher'}
    assert report['schedule']['teacherMinutesRequired'] == 90

    neutral = report['scenarios'][1]
    assert neutral['name'] == 'neutral'
    assert neutral['billableStudents'] == 8
    assert neutral['invoicedMinor'] == '1440007'
    assert neutral['recognizedMinor'] == '720004'
    assert neutral['cashFromTuitionMinor'] == '864004'
    assert neutral['cashFromOpeningDebtMinor'] == '50001'
    assert neutral['cashTotalMinor'] == '914005'
    assert neutral['unpaidTuitionMinor'] == '360002'
    assert neutral['teacherCostMinor'] == '150002'
    assert neutral['contributionMinor'] == '570002'
    assert report['scenarios'][0]['billableStudents'] > neutral['billableStudents']
    assert report['scenarios'][2]['billableStudents'] < neutral['billableStudents']
    assert report['operatingHistory']['course_trials_completed'] == 1
    assert report['operatingHistory']['enrollments_from_leads'] == 1
    assert report['operatingHistory']['withdrawals'] == 1
    assert report['operatingHistory']['held_lessons'] == 0

    multi = (await request(client, owner, 'POST', route, json={
        **inputs, 'forecastMonths':3, 'retentionBps':7500, 'sessionsPerMonth':4,
    }))['scenarios'][1]
    assert [month['billableStudents'] for month in multi['months']] == [8, 6, 5]
    assert [month['cashFromOpeningDebtMinor'] for month in multi['months']] == ['50001','0','0']
    assert multi['teacherCostMinor'] == '1800018'
    assert int(multi['contributionMinor']) == sum(int(month['contributionMinor']) for month in multi['months'])
    assert int(multi['cashTotalMinor']) == sum(int(month['cashTotalMinor']) for month in multi['months'])

    await request(client, owner, 'POST', route, 422, json={**inputs,'tuitionMinor':-1})
    await request(client, owner, 'POST', route, 422, json={**inputs,'collectionBps':True})
    await request(client, owner, 'POST', route, 422, json={**inputs,'forecastMonths':13})
    oversubscribed = await request(client, owner, 'POST', route, json={**inputs,'projectedStudents':12})
    assert oversubscribed['scenarios'][1]['studentsOverCapacity'] == 2
    assert oversubscribed['scenarios'][1]['seatUseBps'] == 10000
    no_demand = await request(client, owner, 'POST', route, json={
        **inputs, 'projectedStudents':0, 'tuitionMinor':'0', 'teacherMinutesAvailable':0,
        'slot':{**inputs['slot'], 'localStart':'11:00'},
    })
    assert no_demand['scenarios'][1]['seatUseBps'] == 0
    assert no_demand['schedule']['conflicts'] == []
    assert no_demand['schedule']['staffingGapMinutes'] == 90
    assert no_demand['schedule']['feasible'] is False
    assert await conn.fetchrow(
        """SELECT (SELECT count(*) FROM academy_sessions) AS sessions,
                  (SELECT count(*) FROM academy_session_reservations) AS reservations,
                  (SELECT count(*) FROM audit_log) AS audit,
                  (SELECT count(*) FROM finance_journal_entries) AS journal"""
    ) == before
