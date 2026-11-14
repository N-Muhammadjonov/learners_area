"""Authorization contract for the tuition/billing API. No database needed.

These are the negative tests the delivery brief demands for a money surface: every role
that must NOT reach a route is proven to be refused, and a teacher reading a student they
are not linked to gets the same response as a student who does not exist, so scope
boundaries are not discoverable by probing ids.
"""
from __future__ import annotations

import re
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
import pytest_asyncio
from starlette.requests import Request

from app import main as core
from app import guardian_port
from app import tuition_port as port

OWNER = uuid4()
ADMIN = uuid4()
TEACHER = uuid4()
STUDENT = uuid4()
LINKED = uuid4()
UNLINKED = uuid4()
ROLES = {str(OWNER): 'owner', str(ADMIN): 'admin', str(TEACHER): 'teacher',
         str(STUDENT): 'student'}


def request(method, path, body=None, query_string=b''):
    headers = [(b'cookie', b'la_session=x')]
    scope = {'type': 'http', 'method': method, 'path': path, 'headers': headers,
             'query_string': query_string, 'scheme': 'https', 'server': ('t', 443)}
    req = Request(scope)
    if body is not None:
        async def receive():
            return {'type': 'http.request', 'body': body, 'more_body': False}
        req._receive = receive
    return req


class Conn:
    async def fetchval(self, sql, *args):
        if 'teacher_student_links' in sql:
            return 1 if args[1] == LINKED else None
        return None

    async def fetchrow(self, *args):
        return None

    async def fetch(self, *args):
        return []


class Pool:
    @asynccontextmanager
    async def acquire(self):
        yield Conn()

    @asynccontextmanager
    async def transaction(self):
        yield


@pytest_asyncio.fixture
async def as_role(monkeypatch):
    """Drive a route as one role against a stub pool; returns the JSON response."""
    async def call(role, method, path, body=None, query_string=b''):
        user_id = {'owner': OWNER, 'admin': ADMIN, 'teacher': TEACHER, 'student': STUDENT}[role]
        user = {'id': user_id, 'role': role, 'account_status': 'active'}

        async def current_user(_req, active=False):
            return user

        async def pool():
            return Pool()

        monkeypatch.setattr(core, 'current_user', current_user)
        monkeypatch.setattr(core, 'pool', pool)
        monkeypatch.setattr(port, '_write_gate', _no_rate_limit)
        handler, params = _match(method, path)
        return await handler(request(method, path, body, query_string), **params)

    return call


async def _no_rate_limit(req, user, rule='finance_write'):
    return None


def _match(method, path):
    """Resolve a concrete URL against the router the way FastAPI would, so path params
    are passed by name instead of hand-parsed from the URL."""
    for route in port.router.routes:
        pattern = re.sub(r'\{(\w+)\}', r'(?P<\1>[^/]+)', route.path)
        matched = re.fullmatch(pattern, path)
        if matched and method in route.methods:
            return route.endpoint, matched.groupdict()
    raise AssertionError(f'no route for {method} {path}')


WRITE_ROUTES = (
    ('POST', '/api/staff/finance/contracts'),
    ('POST', f'/api/staff/finance/contracts/{uuid4()}/approve'),
    ('POST', f'/api/staff/finance/contracts/{uuid4()}/activate'),
    ('POST', f'/api/staff/finance/contracts/{uuid4()}/discounts'),
    ('POST', '/api/staff/finance/charges'),
    ('POST', f'/api/staff/finance/charges/{uuid4()}/post'),
    ('POST', f'/api/staff/finance/charges/{uuid4()}/reverse'),
    ('POST', '/api/staff/finance/payments'),
    ('POST', f'/api/staff/finance/payments/{uuid4()}/refund'),
    ('POST', '/api/staff/finance/revenue/recognize'),
    ('POST', '/api/staff/finance/days/close'),
    ('POST', '/api/staff/finance/periods/close'),
)
CENTRE_READ_ROUTES = (
    ('GET', '/api/staff/finance/summary'),
    ('GET', '/api/staff/finance/reconciliation'),
)


@pytest.mark.asyncio
@pytest.mark.parametrize('method,path', WRITE_ROUTES)
async def test_teacher_and_student_can_never_write_money(as_role, method, path):
    for role in ('teacher', 'student'):
        response = await as_role(role, method, path, b'{}')
        assert response.status_code == 403, f'{role} reached {method} {path}'


@pytest.mark.asyncio
@pytest.mark.parametrize('method,path', CENTRE_READ_ROUTES)
async def test_centre_wide_money_reports_are_owner_and_admin_only(as_role, method, path):
    for role in ('teacher', 'student'):
        response = await as_role(role, method, path)
        assert response.status_code == 403, f'{role} reached {method} {path}'
    for role in ('owner', 'admin'):
        response = await as_role(role, method, path)
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_unauthenticated_callers_are_refused(as_role, monkeypatch):
    async def nobody(_req, active=False):
        return None

    monkeypatch.setattr(core, 'current_user', nobody)
    response = await port.finance_summary(request('GET', '/api/staff/finance/summary'))
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_teacher_statement_is_scoped_to_linked_students(as_role):
    linked = await as_role('teacher', 'GET', f'/api/staff/finance/students/{LINKED}/statement')
    assert linked.status_code == 200
    unlinked = await as_role('teacher', 'GET', f'/api/staff/finance/students/{UNLINKED}/statement')
    # Indistinguishable from a missing student: no hint that the id exists.
    assert unlinked.status_code == 404
    assert b'student_not_found' in unlinked.body
    missing = await as_role('teacher', 'GET', '/api/staff/finance/students/not-a-uuid/statement')
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_owner_and_admin_can_read_any_statement(as_role):
    for role in ('owner', 'admin'):
        response = await as_role(role, 'GET', f'/api/staff/finance/students/{UNLINKED}/statement')
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_student_sees_only_their_own_billing_status(as_role):
    mine = await as_role('student', 'GET', '/api/finance/me')
    assert mine.status_code == 200
    centre = await as_role('student', 'GET', '/api/staff/finance/summary')
    assert centre.status_code == 403
    other = await as_role('student', 'GET', f'/api/staff/finance/students/{LINKED}/statement')
    assert other.status_code == 403


@pytest.mark.asyncio
async def test_staff_cannot_read_billing_through_the_student_route(as_role):
    response = await as_role('owner', 'GET', '/api/finance/me')
    assert response.status_code == 403


@pytest.mark.parametrize('path', [
    '/api/finance/me', '/api/staff/finance/summary', '/api/staff/finance/payments',
    '/api/staff/finance/reconciliation', '/api/staff/finance/students/x/statement'])
def test_guardian_is_blocked_before_reaching_any_finance_route(path):
    """A parent sees the child's academic slice, never the child's finances."""
    assert guardian_port.guardian_path_allowed(path) is False


@pytest.mark.asyncio
async def test_invalid_payloads_are_refused_without_touching_money(as_role):
    cases = (
        ('POST', '/api/staff/finance/contracts', b'not-json'),
        ('POST', '/api/staff/finance/contracts', b'{"studentUserId":"x"}'),
        ('POST', '/api/staff/finance/contracts',
         b'{"studentUserId":"%s","monthlyAmountMinor":800.5,"startsOn":"2026-11-01"}' % str(uuid4()).encode()),
        ('POST', '/api/staff/finance/payments', b'{"amountMinor":100}'),
        ('POST', '/api/staff/finance/days/close', b'{"businessDate":"nope","countedMinor":1}'),
        ('POST', '/api/staff/finance/periods/close', b'{"periodKey":"26"}'),
    )
    for method, path, body in cases:
        response = await as_role('owner', method, path, body)
        assert response.status_code == 400, f'{path} accepted {body!r}'


@pytest.mark.asyncio
async def test_invalid_range_is_refused(as_role):
    response = await as_role('owner', 'GET', '/api/staff/finance/summary', None,
                             b'start=2026-11-30&end=2026-11-01')
    assert response.status_code == 400
