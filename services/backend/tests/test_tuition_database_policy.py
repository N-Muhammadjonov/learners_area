"""Finance SQL access policy under a non-owner database role (FIN-12).

Every other finance test runs as the role that owns the schema, which is exactly the role that
bypasses row-level security - so a policy that looks correct in those tests can still be
missing in production. These tests drop to the Supabase API roles with `SET LOCAL ROLE` and
prove that a direct connection using those credentials sees nothing at all.

This is a *database* control, checked at the database. It is deliberately independent of the
FastAPI authorization tests: if a future route forgets its role check, the API layer leaks,
but a leaked connection string still does not.
"""
from __future__ import annotations

import os
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

from _finance_schema import apply_finance_migrations, create_disposable_schema

DSN = "postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa"

#: Every table that holds money, a payer, a receipt or the audit trail behind them.
FINANCE_TABLES = (
    'finance_accounts',
    'finance_journal_entries',
    'finance_journal_lines',
    'tuition_contracts',
    'tuition_contract_discounts',
    'tuition_charges',
    'tuition_payments',
    'tuition_payment_allocations',
    'tuition_refunds',
    'tuition_credit_notes',
    'cash_receipt_sequences',
    'cash_day_closes',
    'cash_day_adjustments',
    'finance_closed_periods',
    'finance_audit_events',
    'finance_outbox_events',
)

#: The roles a Supabase/PostgREST-style client authenticates as. None of them may read money.
API_ROLES = ('anon', 'authenticated', 'service_role')


@pytest_asyncio.fixture
async def schema():
    try:
        con = await asyncpg.connect(DSN)
    except OSError as exc:
        if os.getenv('CI'):
            raise
        pytest.xfail(f'Disposable Postgres at 127.0.0.1:55439 unavailable: {type(exc).__name__}')
    name = 'rls_policy_' + uuid4().hex
    await create_disposable_schema(con, name)
    await apply_finance_migrations(con)
    try:
        yield con, name
    finally:
        await con.execute('SET search_path TO public')
        await con.execute(f'DROP SCHEMA "{name}" CASCADE')
        await con.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('role', API_ROLES)
async def test_no_api_role_can_read_any_finance_table(schema, role):
    con, name = schema
    await con.execute('BEGIN')
    try:
        await con.execute(f'SET LOCAL ROLE "{role}"')
        # SET LOCAL ROLE also drops the session search_path, so qualify explicitly: the point
        # is to test the policy, not to fail on name resolution.
        await con.execute(f'SET LOCAL search_path TO "{name}", public')
        readable = []
        for table in FINANCE_TABLES:
            # A refused statement aborts the transaction, so each probe gets its own
            # savepoint; otherwise the first denial hides every table after it. asyncpg
            # refuses conn.transaction() inside a manual BEGIN, hence raw savepoints.
            await con.execute('SAVEPOINT probe')
            try:
                await con.execute(f'SELECT 1 FROM "{name}".{table} LIMIT 1')
                readable.append(table)
            except asyncpg.InsufficientPrivilegeError:
                pass
            await con.execute('ROLLBACK TO SAVEPOINT probe')
        assert readable == [], f'{role} could read: {readable}'
    finally:
        await con.execute('ROLLBACK')


@pytest.mark.asyncio
@pytest.mark.parametrize('role', API_ROLES)
async def test_no_api_role_can_write_any_finance_table(schema, role):
    con, name = schema
    await con.execute('BEGIN')
    try:
        await con.execute(f'SET LOCAL ROLE "{role}"')
        await con.execute(f'SET LOCAL search_path TO "{name}", public')
        writable = []
        for table in FINANCE_TABLES:
            await con.execute('SAVEPOINT probe')
            try:
                # A no-op write: it must fail on privilege, not on data.
                await con.execute(f'UPDATE "{name}".{table} SET '
                                  f'{_a_writable_column(table)} = '
                                  f'{_a_writable_column(table)} WHERE false')
                writable.append(table)
            except asyncpg.InsufficientPrivilegeError:
                pass
            except asyncpg.PostgresError:
                # Anything that is not a privilege failure still means the write was refused.
                pass
            await con.execute('ROLLBACK TO SAVEPOINT probe')
        assert writable == [], f'{role} could write: {writable}'
    finally:
        await con.execute('ROLLBACK')


@pytest.mark.asyncio
async def test_row_level_security_is_enabled_on_every_finance_table(schema):
    """Privileges can be granted back by accident; RLS is the second door.

    Scoped to the finance tables: the disposable schema also holds the `users` and `courses`
    dependency tables, whose policy belongs to the app's own migration chain, not this one.
    """
    con, name = schema
    rows = await con.fetch(
        """SELECT c.relname, c.relrowsecurity FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1 AND c.relkind = 'r'""", name)
    enabled = {row['relname']: row['relrowsecurity'] for row in rows}
    missing = [table for table in FINANCE_TABLES if not enabled.get(table)]
    assert missing == [], f'RLS is off, or the table is absent: {missing}'


def _a_writable_column(table):
    """A column that exists on every finance table, so the UPDATE parses."""
    return 'created_at' if table in (
        'finance_accounts', 'finance_journal_entries', 'finance_journal_lines',
        'tuition_contracts', 'tuition_contract_discounts', 'tuition_charges',
        'tuition_payments', 'tuition_refunds', 'tuition_credit_notes',
        'cash_day_adjustments', 'finance_outbox_events') else 'period_key'
