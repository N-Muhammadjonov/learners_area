"""Parent Connect contract tests that need no database."""
from __future__ import annotations

import re
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app import main as core  # main first: ports import it (same order as every other port)
from app import guardian_port as g

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'app/guardian_port.py').read_text()


def request(path):
    return Request({'type': 'http', 'method': 'GET', 'path': path, 'headers': [(b'cookie', b'la_session=x')],
                    'query_string': b'', 'scheme': 'https', 'server': ('t', 443)})


class Conn:
    def __init__(self, role):
        self.role = role

    async def fetchrow(self, *_):
        return {'id': '11111111-1111-1111-1111-111111111111', 'name': 'P', 'email': None, 'role': self.role,
                'account_status': 'active', 'locale': 'uz', 'onboarding_completed_at': None, 'status_reason': None, 'auth_version': 0}


class Pool:
    def __init__(self, role):
        self.role = role

    @asynccontextmanager
    async def acquire(self):
        yield Conn(self.role)


async def authority(monkeypatch, role, path):
    monkeypatch.setattr(core, 'verify_token', lambda _t: {'sub': '11111111-1111-1111-1111-111111111111', 'authVersion': 0,
                                                           'sessionKey': 'k', 'expiresAt': 9999999999})
    async def pool():
        return Pool(role)
    monkeypatch.setattr(core, 'pool', pool)
    return await core._load_authority(request(path))


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['/api/frontend/view', '/api/study-plan/leaderboard', '/api/vocabulary/leaderboard',
                                  '/api/staff/guardians', '/api/guardians/links', '/api/internal/telegram/users/1'])
async def test_guardian_is_forbidden_everywhere_except_allow_list(monkeypatch, path):
    with pytest.raises(HTTPException) as caught:
        await authority(monkeypatch, 'guardian', path)
    assert caught.value.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['/api/guardian/children', '/api/guardian/children/x/progress', '/api/frontend/session',
                                  '/api/auth/logout', '/api/auth/state', '/api/auth/telegram/intent/exchange'])
async def test_guardian_allowed_paths(monkeypatch, path):
    assert (await authority(monkeypatch, 'guardian', path))['user']['role'] == 'guardian'


@pytest.mark.asyncio
async def test_students_are_unaffected(monkeypatch):
    assert (await authority(monkeypatch, 'student', '/api/study-plan/leaderboard'))['user']['role'] == 'student'


def test_guardian_cannot_reach_mutations_even_by_prefix_tricks():
    for path in ('/api/guardians/links/x/approve', '/api/guardianX/children', '/api/guardian', '/api/frontend/staff/x', '/api/auth/telegram/intent/exchange/forged'):
        assert not g.guardian_path_allowed(path)


def test_render_only_substitutes_closed_placeholder_set():
    assert g.render('{student_name}/{guardian_relation}', 'A{b}', 'father', 'en') == 'A{b}/Father'
    body = {'body': 'Hi {grade}', 'linkIds': ['00000000-0000-0000-0000-000000000000']}
    assert g.validate_message(body)[1] == 'unknown_placeholder'
    assert g.validate_message({'body': '{__class__}', 'linkIds': ['00000000-0000-0000-0000-000000000000']})[1] == 'unknown_placeholder'


def test_message_validation_limits():
    ok = ['00000000-0000-0000-0000-000000000000']
    assert g.validate_message({'body': ' ', 'linkIds': ok})[1] == 'invalid_body'
    assert g.validate_message({'body': 'x' * 1501, 'linkIds': ok})[1] == 'invalid_body'
    assert g.validate_message({'body': 'x', 'linkIds': []})[1] == 'invalid_recipients'
    assert g.validate_message({'body': 'x', 'linkIds': ['nope']})[1] == 'invalid_recipients'
    assert g.validate_message({'body': 'x', 'linkIds': ok * 3})[0]['ids'] == ok  # deduplicated


def test_token_shape_and_hash():
    assert g.TOKEN_RE.fullmatch('g_' + 'ab12' * 6)
    assert not g.TOKEN_RE.fullmatch('a' * 64)
    assert len(g.hash_token('g_' + '0' * 24)) == 64


def test_phone_masking_hides_middle_digits():
    assert g.mask_phone('+998901234567').endswith('67') and '12345' not in g.mask_phone('+998901234567')


def test_channel_is_configured_never_invented(monkeypatch):
    monkeypatch.delenv('GUARDIAN_REQUIRED_CHANNEL_ID', raising=False)
    assert g.channel_config() is None
    monkeypatch.setenv('GUARDIAN_REQUIRED_CHANNEL_ID', '-100123')
    monkeypatch.setenv('GUARDIAN_REQUIRED_CHANNEL_URL', 'http://evil.example')
    assert g.channel_config() is None
    monkeypatch.setenv('GUARDIAN_REQUIRED_CHANNEL_URL', 'https://t.me/parents_x')
    assert g.channel_config()['id'] == '-100123'


def test_no_automatic_message_creation_in_source():
    assert not re.search(r'asyncio\.(sleep|create_task)|schedule|cron|lifespan', SOURCE, re.I)
    inserts = [m.start() for m in re.finditer(r'INSERT INTO guardian_message_batches', SOURCE)]
    assert len(inserts) == 1
    send = SOURCE.index('async def staff_send')
    assert send < inserts[0] and "confirm') is not True" in SOURCE[send:inserts[0]]
    assert 'INSERT INTO guardian_message_deliveries' in SOURCE[send:]
    assert SOURCE.count('INSERT INTO guardian_message_deliveries') == 1


@pytest.mark.parametrize('role', ['owner', 'admin', 'teacher'])
def test_staff_eligible_queries_use_teacher_assignment_scope(role):
    user = {'id': '11111111-1111-1111-1111-111111111111', 'role': role}
    query, params = g.scoped_eligible_query(user, ['22222222-2222-2222-2222-222222222222'], lock=True)
    assert 'FOR SHARE OF l' in query
    if role == 'teacher':
        assert 'EXISTS (SELECT 1 FROM teacher_student_links assigned' in query
        assert 'assigned.teacher_user_id=$2' in query
        assert params[1] == user['id']
    else:
        assert 'teacher_student_links' not in query
    assert len(params) == (2 if role == 'teacher' else 1)


@pytest.mark.parametrize('role', ['owner', 'admin', 'teacher'])
@pytest.mark.asyncio
async def test_staff_roles_authorized(monkeypatch, role):
    async def active_user(_req, active=True):
        assert active
        return {'id': '11111111-1111-1111-1111-111111111111', 'role': role}
    monkeypatch.setattr(core, 'current_user', active_user)
    user, denial = await g.staff_user(request('/api/staff/guardians'))
    assert denial is None
    assert user['role'] == role


@pytest.mark.parametrize('role', ['student', 'guardian'])
@pytest.mark.asyncio
async def test_nonstaff_cannot_message_guardians(monkeypatch, role):
    async def active_user(_req, active=True):
        return {'id': '11111111-1111-1111-1111-111111111111', 'role': role}
    monkeypatch.setattr(core, 'current_user', active_user)
    user, denial = await g.staff_user(request('/api/staff/guardians'))
    assert user is None
    assert denial.status_code == 403


def test_all_staff_endpoints_share_role_gate():
    for name in ('staff_guardians', 'staff_guardian_detail', 'staff_templates', 'staff_preview', 'staff_send', 'staff_batch'):
        block = SOURCE[SOURCE.index(f'async def {name}'):][:400]
        assert 'staff_user(req)' in block, name


def test_teacher_scope_filters_directory_preview_send_and_detail():
    assert "where.append(teacher_assignment_sql(user, len(args) + 1))" in SOURCE
    assert "assignment = (' AND ' + teacher_assignment_sql(user, 2))" in SOURCE
    assert "rows = await con.fetch(query, *params)" in SOURCE
    assert "sender_user_id=$2" in SOURCE
    assert "assigned.teacher_user_id=sender.id" in SOURCE
    assert "attempts < $2" in SOURCE


def test_non_owner_pii_masked_in_detail():
    detail = SOURCE.split("async def staff_guardian_detail", 1)[1].split("async def staff_templates", 1)[0]
    assert "'telegramUserId': r['telegram_user_id']" in detail
    assert "if user['role'] == 'owner' else mask_tg" not in detail
    assert "if user['role'] == 'owner' else mask_phone" in detail


def test_migrations_are_forward_only():
    role = (ROOT / 'migrations/0088_guardian_role.sql').read_text()
    assert role.count('ALTER TYPE') == 1 and 'CREATE TABLE' not in role
    sql = (ROOT / 'migrations/0089_guardian_connect.sql').read_text()
    assert not re.search(r'\b(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+\w+\s+DROP)\b', sql, re.I)
    for table in re.findall(r'CREATE TABLE IF NOT EXISTS (\w+)', sql):
        assert f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY' in sql, table
    assert 'guardian_links_live_pair' in sql
