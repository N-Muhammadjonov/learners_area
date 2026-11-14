"""Migration contract: a fresh install is not the same thing as an upgrade (FIN-13).

`npm run backend:test:postgres` built its isolated database by applying every file in
`services/backend/migrations/` in filename order to an EMPTY database. That chain mixes two
kinds of migration:

* schema migrations, which are valid on any database at the prior revision; and
* content migrations, which repair or enrich imported curriculum content and create no table
  of their own.

`0094_listening_1_20_context_audit.sql` is the second kind and ends by asserting an absolute
content count. On an empty database the count is zero, so it raised
``Listening 1-20 must contain 80 transcript Parts`` and aborted the chain at migration 94 of
118 - the tuition finance schema in 1115 was never reached, and the runner could not be used
as an end-to-end signal at all.

The listening validation is correct and stays. What was wrong is running a content repair
against a database that has no content. These tests pin the classification down so it cannot
quietly become an ignore list.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'migrations'
CONTRACT = Path(__file__).parent / 'migration-contract.json'

CONTENT_TABLES = ('listening_packages', 'lexical_occurrences', 'lexemes')
DDL = re.compile(r'\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|TRIGGER|FUNCTION|VIEW|TYPE|SCHEMA)\b',
                 re.IGNORECASE)


def derive() -> tuple[list[str], list[str]]:
    """Split the chain by what the bytes actually do, not by a maintained list."""
    content, structural = [], []
    for path in sorted(MIGRATIONS.glob('*.sql')):
        text = path.read_text()
        if any(table in text for table in CONTENT_TABLES) and not DDL.search(text):
            content.append(path.name)
        else:
            structural.append(path.name)
    return content, structural


def test_the_classification_is_derived_not_hand_maintained():
    """If someone edits the manifest without the bytes changing, this fails.

    That is the whole point: the manifest may not be used to make a migration disappear.
    """
    manifest = json.loads(CONTRACT.read_text())
    content, _ = derive()
    assert manifest['contentMigrations'] == content, (
        'migration-contract.json drifted from the migrations themselves')
    assert manifest['detectedBy']['contentTables'] == list(CONTENT_TABLES)


def test_content_migrations_really_do_create_nothing():
    """A migration that creates a table must never be classified as content-only.

    Deferring one of those on a fresh install would leave the schema incomplete, so the
    classifier's premise is asserted per file rather than trusted.
    """
    manifest = json.loads(CONTRACT.read_text())
    for name in manifest['contentMigrations']:
        text = (MIGRATIONS / name).read_text()
        assert not DDL.search(text), f'{name} contains DDL and must not be deferred'
        assert any(table in text for table in CONTENT_TABLES), f'{name} touches no content'


def test_the_chain_that_aborted_is_the_one_being_described():
    """0094 is the migration that broke the fresh-install path; keep it in the contract."""
    manifest = json.loads(CONTRACT.read_text())
    assert '0094_listening_1_20_context_audit.sql' in manifest['contentMigrations']
    text = (MIGRATIONS / '0094_listening_1_20_context_audit.sql').read_text()
    assert 'must contain 80 transcript Parts' in text, (
        'the absolute content assertion that aborts an empty database is gone - if it was '
        'deliberately removed, update this test and say why')


def test_no_finance_migration_is_deferred():
    """The tuition finance chain is pure schema and must always run, on both paths."""
    manifest = json.loads(CONTRACT.read_text())
    deferred = set(manifest['contentMigrations'])
    finance = {name for name in deferred
               if name.startswith(('1115', '1116', '1117', '1118', '1119', '1120', '1121'))}
    assert finance == set(), f'finance migrations must never be deferred: {sorted(finance)}'


def test_structural_migrations_cover_every_table_the_finance_schema_needs():
    """Sanity: the non-deferred half of the chain is what actually builds the schema."""
    _, structural = derive()
    joined = '\n'.join((MIGRATIONS / name).read_text() for name in structural)
    for table in ('tuition_charges', 'tuition_credit_notes', 'finance_audit_events',
                  'finance_outbox_events', 'cash_day_adjustments'):
        assert f'CREATE TABLE IF NOT EXISTS {table}' in joined, f'{table} is only in a deferred migration'


@pytest.mark.parametrize('name', ['1115_tuition_finance.sql', '1116_tuition_finance_corrections.sql',
                                  '1117_tuition_charge_approval.sql',
                                  '1118_refund_lifecycle_and_cash_day.sql',
                                  '1119_provider_clearing_account.sql',
                                  '1120_freeze_contract_terms.sql',
                                  '1121_finance_outbox_dispatch.sql'])
def test_finance_migrations_are_idempotent_and_non_destructive(name):
    """Forward-only: re-running is safe, and nothing is dropped or truncated.

    1115 is committed and tracked, so it is never edited; every correction after it is a new
    file. A destructive statement in a finance migration would be a data-loss risk on any
    environment that already applied the earlier ones.
    """
    text = (MIGRATIONS / name).read_text()
    for forbidden in ('DROP TABLE', 'TRUNCATE', 'DELETE FROM', 'DROP COLUMN'):
        assert forbidden not in text.upper(), f'{name} contains {forbidden}'
    # Every object creation must tolerate already existing, so a re-run cannot fail.
    creates = re.findall(r'CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|OR REPLACE FUNCTION)', text,
                         re.IGNORECASE)
    tolerant = len(re.findall(r'CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF NOT EXISTS'
                              r'|CREATE OR REPLACE FUNCTION', text, re.IGNORECASE))
    assert tolerant == len(creates), f'{name} has a CREATE that is not idempotent'


# ─────────────────────────── the chain is schema-independent ───────────────────────────
# `information_schema` describes the whole DATABASE, not the current schema. A migration
# guard that asks "does this column exist anywhere in this database?" will answer yes because
# of a schema it has nothing to do with, and then act on the current schema. That is exactly
# what 1116 did: it checked for `tuition_refunds.status` without qualifying the schema, so
# once ANY schema in the database had finished the chain, every later application into a new
# schema tried to add a CHECK on a column the new schema did not have yet, and failed with
# `column "status" does not exist`. The finance test suite is built on disposable schemas, so
# this was not a theoretical risk - it made the second finance test in a run fail.
DSN = 'postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/coin_qa'


@pytest.mark.asyncio
async def test_the_chain_applies_into_a_second_schema_of_the_same_database():
    """A finished schema in the database must not change what a later application does."""
    from _finance_schema import apply_finance_migrations, create_disposable_schema

    try:
        con = await asyncpg.connect(DSN)
    except OSError as exc:
        if os.getenv('CI'):
            raise
        pytest.xfail(f'Disposable Postgres at 127.0.0.1:55439 unavailable: {type(exc).__name__}')

    first, second = f'fin13_first_{uuid4().hex[:8]}', f'fin13_second_{uuid4().hex[:8]}'
    try:
        # First application leaves a fully migrated schema behind, refunds.status included.
        await create_disposable_schema(con, first)
        await apply_finance_migrations(con)
        assert await con.fetchval(
            "SELECT count(*) FROM information_schema.columns WHERE table_schema=$1"
            " AND table_name='tuition_refunds' AND column_name='status'", first) == 1

        # Second application, same database, different schema. This used to raise.
        await create_disposable_schema(con, second)
        await apply_finance_migrations(con)
        for table in ('tuition_charges', 'tuition_refunds', 'finance_outbox_events'):
            assert await con.fetchval(
                'SELECT count(*) FROM information_schema.tables WHERE table_schema=$1'
                ' AND table_name=$2', second, table) == 1, f'{table} missing in the second schema'
    finally:
        for schema in (first, second):
            await con.execute('SET search_path TO public')
            await con.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await con.close()


def test_no_finance_migration_guard_reads_a_database_wide_catalog_unqualified():
    """The structural cause, asserted on the SQL so it cannot come back.

    `information_schema.*` has no implicit schema filter. Any guard against it must name the
    schema it means. `pg_roles` is genuinely cluster-wide and is exempt.
    """
    for name in ('1115_tuition_finance.sql', '1116_tuition_finance_corrections.sql',
                 '1117_tuition_charge_approval.sql', '1118_refund_lifecycle_and_cash_day.sql',
                 '1119_provider_clearing_account.sql', '1120_freeze_contract_terms.sql',
                 '1121_finance_outbox_dispatch.sql'):
        text = (MIGRATIONS / name).read_text()
        for match in re.finditer(r'information_schema\.(\w+)', text):
            statement_start = text.rfind('SELECT', 0, match.start())
            window = text[statement_start:match.start() + 400]
            assert 'table_schema' in window, (
                f'{name}: guard on information_schema.{match.group(1)} does not filter by '
                f'table_schema, so another schema in the database can decide its behaviour')
