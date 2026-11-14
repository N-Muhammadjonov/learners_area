"""Apply the tuition finance migration chain to a disposable schema.

Finance tests must run the REAL migrations, in order, against real PostgreSQL - not a
hand-written copy of the schema. `FINANCE_MIGRATIONS` is the single ordered list; both
`test_tuition_ledger.py` and `test_tuition_provider_http.py` use it, so a migration added
for a defect fix is exercised everywhere at once.
"""
from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import asyncpg
import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport

MIGRATION_DIR = Path(__file__).resolve().parents[1] / 'migrations'
FINANCE_MIGRATIONS = (
    '1115_tuition_finance.sql',
    '1116_tuition_finance_corrections.sql',
    '1117_tuition_charge_approval.sql',
)

BOOTSTRAP = (
    """CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text, email text, role text DEFAULT 'student', account_status text DEFAULT 'active',
        locale text DEFAULT 'uz', onboarding_completed_at timestamptz, status_reason text,
        auth_version integer DEFAULT 0)""",
    'CREATE TABLE IF NOT EXISTS courses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),'
    ' title text)',
)
API_ROLES = ('anon', 'authenticated', 'service_role')


async def create_disposable_schema(con, schema: str) -> None:
    """Create an empty schema with the two dependency tables the finance migrations need."""
    await con.execute(f'CREATE SCHEMA "{schema}"')
    await con.execute(f'SET search_path TO "{schema}", public')
    for role in API_ROLES:
        if not await con.fetchval('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)', role):
            await con.execute(f'CREATE ROLE "{role}"')
    await con.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}"'
                      ' GRANT ALL ON TABLES TO anon,authenticated,service_role')
    for statement in BOOTSTRAP:
        await con.execute(statement)


async def apply_finance_migrations(con) -> None:
    """Run the finance migrations in order, exactly as the production runner would."""
    for name in FINANCE_MIGRATIONS:
        for statement in (MIGRATION_DIR / name).read_text().split('--> statement-breakpoint'):
            if statement.strip():
                await con.execute(statement)


DSN = "postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa"


@pytest_asyncio.fixture
async def http(monkeypatch):
    """Real `app.main` over ASGI, backed by a disposable PostgreSQL schema.

    Finance behaviour is only proven when the whole request path runs: router, auth,
    input shaping, ledger transaction, journal trigger. Nothing here is a mock - if a
    connection to the disposable database is impossible the test is skipped locally and
    fails in CI, where the database is part of the job.
    """
    from app import main as core

    try:
        con = await asyncpg.connect(DSN)
    except OSError as exc:
        if os.getenv('CI'):
            raise
        pytest.xfail(f'Disposable Postgres at 127.0.0.1:55439 unavailable: {type(exc).__name__}')
    schema = 'finance_http_' + uuid4().hex
    await create_disposable_schema(con, schema)
    await apply_finance_migrations(con)

    async def make(role):
        return await con.fetchval('INSERT INTO users(role) VALUES($1) RETURNING id', role)

    people = {'owner': await make('owner'), 'admin': await make('admin'),
              'teacher': await make('teacher'), 'student': await make('student'),
              'other_student': await make('student')}
    pool = await asyncpg.create_pool(DSN, min_size=1, max_size=6,
                                     server_settings={'search_path': f'"{schema}", public'})

    async def app_pool():
        return pool

    monkeypatch.setattr(core, 'pool', app_pool)
    transport = ASGITransport(app=core.app)
    async with httpx.AsyncClient(transport=transport, base_url='https://t.test') as client:
        client.con = con
        client.people = people
        client.schema = schema
        yield client

    await pool.close()
    await con.execute('SET search_path TO public')
    await con.execute(f'DROP SCHEMA "{schema}" CASCADE')
    await con.close()


async def staff(client, role, method, path, *, json_body=None, params=None, monkeypatch=None):
    """Call a finance route as one staff role with the write gate open."""
    from app import main as core
    from app import tuition_port as port

    user = {'id': client.people[role], 'role': role, 'account_status': 'active'}

    async def current_user(_req, active=False):
        return user

    async def no_limit(req, usr, rule='finance_write'):
        return None

    previous_user, previous_gate = core.current_user, port._write_gate
    core.current_user, port._write_gate = current_user, no_limit
    try:
        return await client.request(method, path, json=json_body, params=params)
    finally:
        core.current_user, port._write_gate = previous_user, previous_gate
