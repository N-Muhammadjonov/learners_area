"""Real HTTP/PostgreSQL proof for deterministic operational assistance."""
from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from uuid import UUID, uuid4
import zipfile

import pytest

from app import academy_assistant as assistant, academy_attendance, finance_balance_packets as packets
from app import riwi_workflows as workflows, tuition_ledger as ledger
from app.riwi_capabilities import RiwiActor
from app.security import SESSION_COOKIE, issue_token
from test_self_service_payments import family, journey, request


async def packet(client, actor: dict, students: list[str]):
    return await client.get('/api/staff/finance/balance-packets.zip', params={'studentIds': ','.join(students)},
                            headers={'origin': 'https://journey.test', 'cookie': SESSION_COOKIE + '=' + issue_token(actor)})


def unpack(content: bytes) -> tuple[dict, list[dict], dict[str, bytes]]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(files['manifest.json'])
    rows = list(csv.DictReader(io.StringIO(files['accounts.csv'].decode('utf-8-sig'))))
    return manifest, rows, files


@pytest.mark.asyncio
async def test_private_balance_packet_preserves_exact_ledger_values_and_verifiable_files(family):
    conn, client, actors, _ = family
    await conn.execute('UPDATE users SET name=$2 WHERE id=$1', actors['student']['id'], '=HYPERLINK("invalid")')
    await ledger.record_payment(conn, actor_user_id=actors['admin']['id'], student_user_id=actors['student']['id'],
                                amount_minor=137531, idempotency_key='packet-exact-cash')
    students = [str(actors[key]['id']) for key in ('student', 'second')]
    before = await conn.fetchval('SELECT count(*) FROM finance_journal_entries')
    response = await packet(client, actors['admin'], students)
    assert response.status_code == 200, response.text
    assert response.headers['cache-control'] == 'private, no-store'
    assert response.headers['x-content-type-options'] == 'nosniff'
    manifest, rows, files = unpack(response.content)
    assert manifest['scope'] == 'current_ledger_positions' and manifest['accountCount'] == 2
    assert manifest['amountUnit'] == 'whole_UZS'
    assert manifest['totals']['balanceDueMinor'] == 1062469
    assert manifest['historicalOpeningBalanceIncluded'] is False and manifest['fiscalDocument'] is False
    assert len({row['asOf'] for row in rows}) == 1
    for row in rows:
        position = await ledger.student_position(conn, UUID(row['studentUserId']))
        assert all(int(row[field]) == position[field] for field in packets.MONEY_FIELDS)
    assert next(row for row in rows if row['studentUserId'] == students[0])['studentName'].startswith("'=")
    for item in manifest['files']:
        assert hashlib.sha256(files[item['name']]).hexdigest() == item['sha256']
        assert len(files[item['name']]) == item['bytes']
    assert all(name == 'accounts.csv' or name == 'manifest.json' or name.startswith('accounts/') for name in files)
    assert packets.build_packet([{**await ledger.student_position(conn, actors['student']['id']),
                                  'studentName': 'Test', 'asOf': 'fixed'}]) == packets.build_packet([
                                      {**await ledger.student_position(conn, actors['student']['id']),
                                       'studentName': 'Test', 'asOf': 'fixed'}])
    assert await conn.fetchval('SELECT count(*) FROM finance_journal_entries') == before


@pytest.mark.asyncio
async def test_balance_packet_uses_one_snapshot_even_when_cash_settles_between_accounts(family, monkeypatch):
    conn, client, actors, _ = family
    ids = sorted([actors[key]['id'] for key in ('student', 'second')], key=str)
    original = ledger.student_position
    expected = {str(student): (await original(conn, student))['balanceDueMinor'] for student in ids}
    fired = False

    async def settle_between_accounts(reader, student):
        nonlocal fired
        result = await original(reader, student)
        if not fired:
            fired = True
            await ledger.record_payment(conn, actor_user_id=actors['admin']['id'], student_user_id=ids[1],
                                        amount_minor=123457, idempotency_key='packet-concurrent-cash')
        return result

    monkeypatch.setattr(ledger, 'student_position', settle_between_accounts)
    response = await packet(client, actors['owner'], [str(value) for value in ids])
    assert response.status_code == 200, response.text
    _, rows, _ = unpack(response.content)
    assert {row['studentUserId']: int(row['balanceDueMinor']) for row in rows} == expected
    assert (await original(conn, ids[1]))['balanceDueMinor'] == expected[str(ids[1])] - 123457


@pytest.mark.asyncio
async def test_packet_role_and_selection_boundaries_do_not_create_partial_exports(family):
    _, client, actors, _ = family
    students = [str(actors['student']['id'])]
    for role in ('teacher', 'student', 'guardian'):
        response = await packet(client, actors[role], students)
        assert response.status_code == 403
    for selection in ([], students * 2, ['not-a-uuid'], [str(uuid4()) for _ in range(21)]):
        assert (await packet(client, actors['owner'], selection)).status_code == 422
    assert (await packet(client, actors['owner'], students + [str(actors['teacher']['id'])])).status_code == 404


async def attendance_session(conn, actors: dict, *, days: int, status: str = 'held', assigned: bool = True):
    course = await conn.fetchval("INSERT INTO courses(slug,title) VALUES($1,'Automation class') RETURNING id", 'automation-' + uuid4().hex)
    group = await conn.fetchval('''INSERT INTO academy_groups(course_id,name,branch,capacity,starts_on)
        VALUES($1,'Frozen roster','QA',20,current_date-30) RETURNING id''', course)
    await conn.execute('''INSERT INTO academy_group_memberships(group_id,course_id,student_user_id,status,starts_on,activated_on)
        VALUES($1,$2,$3,'active',current_date-30,current_date-30)''', group, course, actors['student']['id'])
    start = datetime.now(timezone.utc) - timedelta(days=days, hours=2)
    session = await conn.fetchrow('''INSERT INTO academy_sessions(group_id,series_id,branch,room,starts_at,ends_at,status)
        VALUES($1,$2,'QA','A',$3,$4,$5) RETURNING *''', group, uuid4(), start, start + timedelta(hours=1), status)
    if assigned:
        await conn.execute('INSERT INTO academy_session_teachers(session_id,teacher_user_id) VALUES($1,$2)',
                           session['id'], actors['teacher']['id'])
    await academy_attendance.snapshot(conn, session)
    return session


@pytest.mark.asyncio
async def test_today_finds_only_unmarked_held_rosters_and_rechecks_teacher_assignment(family):
    conn, client, actors, _ = family
    own = await attendance_session(conn, actors, days=1)
    await attendance_session(conn, actors, days=2, assigned=False)
    complete = await attendance_session(conn, actors, days=1)
    await conn.execute("UPDATE academy_attendance SET status='present',marked_at=now() WHERE session_id=$1", complete['id'])
    await attendance_session(conn, actors, days=0, status='scheduled')
    await attendance_session(conn, actors, days=10)
    owner = await request(client, actors['owner'], 'GET', '/api/staff/academy/today')
    assert owner['attendance']['count'] == 2 and owner['attendance']['windowDays'] == 7
    teacher = await request(client, actors['teacher'], 'GET', '/api/staff/academy/today')
    assert teacher['attendance']['count'] == 1
    assert teacher['attendance']['items'][0]['id'] == str(own['id'])
    assert teacher['attendance']['items'][0]['unmarked'] == 1
    assert 'balances' not in teacher
    await conn.execute('DELETE FROM academy_session_teachers WHERE session_id=$1', own['id'])
    assert (await request(client, actors['teacher'], 'GET', '/api/staff/academy/today'))['attendance']['count'] == 0
    empty = await request(client, actors['owner'], 'GET', '/api/staff/academy/today?attendanceOffset=10')
    assert empty['attendance']['count'] == 2 and empty['attendance']['items'] == []


@pytest.mark.asyncio
async def test_workflow_selector_is_role_scoped_and_question_cannot_grant_execution(family):
    _, client, actors, _ = family
    route = '/api/staff/academy/assistant/proposals'
    result = await request(client, actors['owner'], 'POST', route, json={
        'action': 'daily_brief', 'locale': 'uz', 'question': 'Davomat jarayonini avtomatlashtirish'})
    assert result['workflows'][0]['id'] == 'attendance' and result['questionMatched']
    assert result['contextVersion'] == workflows.version() and result['canExecute'] is False
    assert all(row['href'].startswith('/app/') for row in result['workflows'])
    await request(client, actors['teacher'], 'POST', route, 403, json={'action': 'daily_brief', 'workflowId': 'collections'})
    await request(client, actors['student'], 'POST', '/api/finance/me/assistant', 403,
                  json={'action': 'payment_help', 'workflowId': 'balance_packets'})
    child = actors['second']['id']
    guardian = await request(client, actors['guardian'], 'POST', f'/api/guardian/children/{child}/assistant',
                             json={'action': 'payment_help'})
    assert guardian['workflows'][0]['href'] == '/app/payments?child=' + str(child)
    teacher = await request(client, actors['teacher'], 'POST', route, json={'action': 'daily_brief'})
    assert {row['id'] for row in teacher['availableWorkflows']} == {'attendance', 'parent_message'}


@pytest.mark.asyncio
async def test_external_context_is_current_scoped_and_cannot_replace_money_or_drop_facts(monkeypatch):
    for key, value in {'RIWI_EXTERNAL_AI_ENABLED': '1', 'AI_EXTERNAL_ENABLED': 'true',
                       'ACADEMY_AI_EXTERNAL_ENABLED': '1', 'ACADEMY_AI_PROVIDER_VERIFIED': '1',
                       'AI_GATEWAY_API_KEY': 'isolated', 'AI_GATEWAY_MODEL': 'fixture/model'}.items():
        monkeypatch.setenv(key, value)
    sent = []

    async def completion(actor, model, instructions, payload, **kwargs):
        sent.append(payload)
        return {'evidenceIds': ['balance'], 'workflowIds': ['payments']}, {'inputTokens': 5, 'outputTokens': 2}

    monkeypatch.setattr(assistant.gateway, 'completion', completion)
    facts = {'observedAt': 'fixed', 'evidence': [
        {'id': 'balance', 'kind': 'balance_due', 'value': 137531, 'unit': 'UZS', 'sourceHref': '/app/payments'},
        {'id': 'refund', 'kind': 'settled_refunds', 'value': 89, 'unit': 'UZS', 'sourceHref': '/app/payments'}]}
    result, _ = await assistant.propose('private-actor', assistant.AssistantRequest(
        action='payment_help', question='secret@example.test +998901234567'), facts, role='guardian')
    assert result['mode'] == 'external' and len(result['evidence']) == 2
    assert result['evidence'][0]['value'] == 137531
    context = sent[0]['processContext']
    assert context['version'] == workflows.version()
    assert [row['id'] for row in context['workflows']] == ['payments']
    assert not any(secret in json.dumps(sent) for secret in ('private-actor', 'example.test', '998901234567', 'sourceHref'))

    async def forged(*args, **kwargs):
        return {'evidenceIds': ['balance'], 'workflowIds': ['collections']}, {}

    monkeypatch.setattr(assistant.gateway, 'completion', forged)
    fallback, _ = await assistant.propose('actor', assistant.AssistantRequest(action='payment_help'), facts, role='student')
    assert fallback['mode'] == 'fallback' and len(fallback['evidence']) == 2
    assert fallback['workflows'][0]['id'] == 'payments'

    async def suggest_packet(*args, **kwargs):
        return {'evidenceIds': ['balance'], 'workflowIds': ['balance_packets']}, {}

    monkeypatch.setattr(assistant.gateway, 'completion', suggest_packet)
    owner, _ = await assistant.propose('owner', assistant.AssistantRequest(action='daily_brief'), facts, role='owner')
    assert owner['mode'] == 'external' and owner['workflows'][0]['id'] == 'balance_packets'
    pinned, _ = await assistant.propose('owner', assistant.AssistantRequest(
        action='daily_brief', workflowId='attendance'), facts, role='owner')
    assert pinned['mode'] == 'fallback' and pinned['workflows'][0]['id'] == 'attendance'


def test_local_process_guide_avoids_learning_collisions_and_context_updates_with_registry(monkeypatch):
    actor = RiwiActor(id=str(uuid4()), role='owner')
    result = workflows.reply(actor, 'Qarz undirish jarayonini tushuntir', 'uz')
    assert result and result['provider']['model'] == 'riwi-workflow-v1'
    assert result['navigationLinks'][0]['href'] == '/app/management/finance?view=debts'
    # The declared process vocabulary may match an exact reviewed term; it never
    # fabricates an executor or infers a record ID from arbitrary text.
    assert workflows.reply(actor, 'Explain the grammar in this sentence about a process', 'en') is None
    assert workflows.matching('owner', 'leaderboard') == []
    assert workflows.allowed('teacher', 'collections') is False
    assert 'balance_packets' in workflows.external_summary('owner')
    assert 'balance_packets' not in workflows.external_summary('student')
    before = workflows.version()
    monkeypatch.setattr(workflows, 'WORKFLOWS', workflows.WORKFLOWS[:-1])
    assert workflows.version() != before


def test_packet_names_are_readable_unique_and_cannot_escape_the_archive_folder():
    rows = []
    for name in ('../../same/name', '../../same/name', 'O‘quvchi' * 100):
        rows.append({'studentUserId': str(uuid4()), 'studentName': name, 'currency': 'UZS',
                     **{key: 0 for key in packets.MONEY_FIELDS}, 'asOf': 'fixed'})
    content, _ = packets.build_packet(rows)
    manifest, output, files = unpack(content)
    accounts = [name for name in files if name.startswith('accounts/')]
    assert len(accounts) == len(set(accounts)) == 3
    assert all(name.count('/') == 1 and '..' not in name and len(name.rsplit('/', 1)[1].encode()) < 255 for name in accounts)
    assert any(name.startswith('accounts/same-name-') for name in accounts)
    assert [row['studentName'] for row in output] == [row['studentName'] for row in rows]
    assert manifest['accountCount'] == 3


def test_provider_context_describes_runtime_availability_without_disclosing_credentials(monkeypatch):
    for key, value in {'ACADEMY_FEATURES_ENABLED': '1', 'ACADEMY_ASSISTANT_ENABLED': '1',
                       'SELF_SERVICE_PAYMENTS_ENABLED': '0', 'PREPAID_BILLING_ENABLED': '0',
                       'CLICK_SERVICE_ID': '123', 'CLICK_MERCHANT_ID': '456',
                       'CLICK_SECRET_KEY': 'private-merchant-proof', 'CLICK_LIVE_VERIFIED': '0',
                       'PAYMENTS_RETURN_ORIGIN': 'https://fixture.invalid'}.items():
        monkeypatch.setenv(key, value)
    context = workflows.provider_context('owner')
    assert context['moduleAvailability']['academy'] is True
    assert context['moduleAvailability']['payments'] is False
    assert context['moduleAvailability']['prepaidPurchases'] is False
    assert context['moduleAvailability']['paymentMethods']['click'] is False
    assert 'private-merchant-proof' not in json.dumps(context)
    assert 'paymentMethods' not in workflows.provider_context('teacher')['moduleAvailability']
