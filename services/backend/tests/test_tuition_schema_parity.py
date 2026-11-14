"""The typed TypeScript schema must match the migrated database, and money must not round.

FIN-12: `src/db/schema.ts` declared every financial `bigint` as `mode: "number"`. A JS number
is a double, so it is exact only to 2^53; a bigint column can hold far more, and any value
past that boundary silently loses precision on the way into the client. For money that is not
a theoretical risk - it is a wrong balance with no error anywhere.

These tests read the REAL migration chain into a disposable database and compare it against
the TypeScript declarations, so a column added by a migration without a schema change (or the
other way round) fails here rather than at runtime.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio

from _finance_schema import apply_finance_migrations, create_disposable_schema

DSN = "postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa"
SCHEMA_TS = Path(__file__).resolve().parents[3] / 'src' / 'db' / 'schema.ts'

#: The finance tables this release owns. Everything else in schema.ts predates it.
FINANCE_TABLES = (
    'finance_accounts', 'finance_journal_entries', 'finance_journal_lines',
    'tuition_contracts', 'tuition_contract_discounts', 'tuition_charges', 'tuition_payments',
    'tuition_payment_allocations', 'tuition_refunds', 'tuition_credit_notes',
    'cash_receipt_sequences', 'cash_day_closes', 'cash_day_adjustments',
    'finance_closed_periods', 'finance_audit_events', 'finance_outbox_events',
)


def typed_tables() -> dict[str, dict[str, str]]:
    """Parse `pgTable("name", { ... })` blocks into {table: {column: declaration}}."""
    source = SCHEMA_TS.read_text()
    out = {}
    for match in re.finditer(r'pgTable\(\s*"([a-z_0-9]+)"\s*,\s*\{', source):
        name = match.group(1)
        depth, index = 1, match.end()
        while depth and index < len(source):
            if source[index] == '{':
                depth += 1
            elif source[index] == '}':
                depth -= 1
            index += 1
        body = source[match.end():index - 1]
        columns = {}
        for line in body.split('\n'):
            column = re.match(r'\s*(\w+):\s*(\w+)\(\s*"([a-z_0-9]+)"(.*)', line)
            if column:
                columns[column.group(3)] = line.strip()
        out[name] = columns
    return out


@pytest.fixture(scope='module')
def declarations():
    return typed_tables()


@pytest_asyncio.fixture
async def migrated():
    try:
        con = await asyncpg.connect(DSN)
    except OSError as exc:
        if os.getenv('CI'):
            raise
        pytest.xfail(f'Disposable Postgres at 127.0.0.1:55439 unavailable: {type(exc).__name__}')
    schema = 'schema_parity_' + uuid4().hex
    await create_disposable_schema(con, schema)
    await apply_finance_migrations(con)
    try:
        yield con, schema
    finally:
        await con.execute('SET search_path TO public')
        await con.execute(f'DROP SCHEMA "{schema}" CASCADE')
        await con.close()


def test_the_typescript_schema_file_is_where_this_test_expects():
    assert SCHEMA_TS.exists(), f'{SCHEMA_TS} not found - the parity check would silently pass'


@pytest.mark.asyncio
async def test_every_finance_table_and_column_is_declared(migrated, declarations):
    con, schema = migrated
    rows = await con.fetch(
        """SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = $1 ORDER BY table_name, ordinal_position""", schema)
    database = {}
    for row in rows:
        database.setdefault(row['table_name'], set()).add(row['column_name'])

    for table in FINANCE_TABLES:
        assert table in database, f'{table} was not created by the migration chain'
        assert table in declarations, f'{table} is missing from src/db/schema.ts'
        declared = set(declarations[table])
        actual = database[table]
        assert actual - declared == set(), f'{table}: columns missing from schema.ts'
        assert declared - actual == set(), f'{table}: schema.ts declares columns that do not exist'


@pytest.mark.asyncio
async def test_no_financial_bigint_is_typed_as_a_javascript_number(migrated, declarations):
    """A bigint money column must be BigInt or string in TypeScript, never `number`."""
    con, schema = migrated
    bigints = await con.fetch(
        """SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = $1 AND data_type = 'bigint'""", schema)
    assert bigints, 'no bigint columns found - the check would be vacuous'
    unsafe = []
    for row in bigints:
        table, column = row['table_name'], row['column_name']
        declaration = declarations.get(table, {}).get(column)
        if declaration is None:
            continue  # covered by the parity test above
        if 'mode: "number"' in declaration:
            unsafe.append(f'{table}.{column}')
    assert unsafe == [], (
        f'these bigint columns would lose precision past 2^53: {sorted(unsafe)}')


@pytest.mark.asyncio
async def test_a_money_value_beyond_double_precision_survives_the_database(migrated):
    """Proves the precision the typed layer must not throw away.

    9,007,199,254,740,993 minor units is 2^53 + 1: the first integer a JS double cannot
    represent. It is not a realistic tuition fee, but it is exactly the value that would be
    silently rounded if the column were typed as a number - and the same silent rounding
    happens at any magnitude once a sum crosses the boundary.
    """
    con, schema = migrated
    await con.execute(f'SET search_path TO "{schema}", public')
    beyond_double = 2 ** 53 + 1
    student = await con.fetchval("INSERT INTO users(role) VALUES('student') RETURNING id")
    entry = await con.fetchrow(
        "INSERT INTO finance_journal_entries (transaction_id, source_type, source_id, memo)"
        " VALUES (gen_random_uuid(),'test',gen_random_uuid(),'precision probe')"
        ' RETURNING id, transaction_id')
    async with con.transaction():
        for account, direction in (('accounts_receivable', 'debit'),
                                   ('tuition_revenue', 'credit')):
            await con.execute(
                'INSERT INTO finance_journal_lines (transaction_id, entry_id, account_id,'
                ' direction, amount_minor, currency_code) VALUES ($1,$2,(SELECT id FROM'
                " finance_accounts WHERE code=$3),$4,$5,'UZS')",
                entry['transaction_id'], entry['id'], account, direction, beyond_double)
    stored = await con.fetchval(
        'SELECT amount_minor FROM finance_journal_lines WHERE entry_id=$1 LIMIT 1', entry['id'])
    assert int(stored) == beyond_double, 'the database itself lost precision'
    assert int(stored) != float(stored), (
        'this value is exactly the one a JS number cannot hold, which is why the typed'
        ' schema must not use mode: "number"')
    assert await con.fetchval(
        'SELECT count(*) FROM tuition_charges WHERE student_user_id=$1', student) == 0
