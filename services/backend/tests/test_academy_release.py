"""Native backup/restore and fail-closed production-release rehearsal."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import shutil
from typing import Iterator

import asyncpg
import pytest

from tools import academy_release as release
from tools import payments_release_plan as feature

PROJECT = 'tuoeabrrnsiuxpjmslxp'
ACCOUNT = 'd953f7ff0eedad092d7059969125244d'
BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def pg_bin() -> Path:
    path = Path(os.getenv('PG17_BIN', '/usr/lib/postgresql/17/bin'))
    assert (path/'pg_dump').is_file(), 'Install PostgreSQL 17 server/client or set PG17_BIN'
    return path


async def seed_source(dsn: str) -> None:
    await release.prepare_local(dsn, ['postgres', 'anon', 'authenticated', 'service_role'])
    conn = await asyncpg.connect(dsn)
    try:
        deferred = set(json.loads((BACKEND/'tests/migration-contract.json').read_text())['contentMigrations'])
        for file in sorted((BACKEND/'migrations').glob('*.sql')):
            if file.name < '1115' and file.name not in deferred:
                for sql in file.read_text().split('--> statement-breakpoint'):
                    statement = '\n'.join(line for line in sql.splitlines() if not line.lstrip().startswith('--'))
                    if statement.strip():
                        await conn.execute(statement)
        await conn.execute("INSERT INTO users(name,role,account_status) VALUES('Synthetic existing learner','student','active')")
        # Reproduce Supabase's API defaults. Each new managed table must revoke them.
        await conn.execute('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role')
    finally:
        await conn.close()


@pytest.fixture
def source(tmp_path: Path, pg_bin: Path) -> Iterator[str]:
    base = tmp_path/'source'
    base.mkdir(mode=0o700)
    with release.local_database(base, pg_bin) as dsn:
        asyncio.run(seed_source(dsn))
        yield dsn


class FileStorage:
    def __init__(self, root: Path, *, corrupt: bool = False) -> None:
        self.root, self.corrupt = root, corrupt
        self.uploads = 0

    def upload_file(self, filename: str, bucket: str, key: str, **kwargs: object) -> None:
        target = self.root/key
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(filename, target)
        self.uploads += 1

    def download_file(self, bucket: str, key: str, filename: str) -> None:
        shutil.copyfile(self.root/key, filename)
        if self.corrupt:
            Path(filename).write_bytes(b'corrupted transfer')

    def put_object(self, *, Bucket: str, Key: str, Body: bytes, **kwargs: object) -> None:
        (self.root/Key).write_bytes(Body)


async def assert_trigger_boundaries(conn: asyncpg.Connection) -> None:
    await conn.execute('''
        CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $$
        DECLARE command record;
        BEGIN
            FOR command IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
                IF command.object_type='table' AND command.schema_name='public' THEN
                    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',command.object_identity);
                END IF;
            END LOOP;
        END $$;
        CREATE EVENT TRIGGER private_rls_test ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.rls_auto_enable();
    ''')
    paths = list((BACKEND.parents[1]/'supabase/migrations').glob('*_private_trigger_function_boundaries.sql'))
    assert len(paths) == 1
    await conn.execute(paths[0].read_text())
    await conn.execute(paths[0].read_text())
    for role in ('anon', 'authenticated', 'service_role'):
        assert not await conn.fetchval(
            "SELECT has_function_privilege($1,'public.rls_auto_enable()','EXECUTE')", role)
    await conn.execute('CREATE TABLE public.rls_after_revocation(id int)')
    assert await conn.fetchval("SELECT relrowsecurity FROM pg_class WHERE oid='public.rls_after_revocation'::regclass")
    # A forged temporary table must not hide an unbalanced real entry.
    with pytest.raises(asyncpg.CheckViolationError):
        async with conn.transaction():
            await conn.execute('SET LOCAL search_path TO pg_temp,public')
            await conn.execute('CREATE TEMP TABLE finance_journal_lines(transaction_id uuid,amount_minor bigint,direction text) ON COMMIT DROP')
            entry = await conn.fetchrow('''
                INSERT INTO public.finance_journal_entries(transaction_id,source_type,source_id)
                VALUES(gen_random_uuid(),'test',gen_random_uuid()) RETURNING id,transaction_id
            ''')
            inserted = await conn.execute('''
                INSERT INTO public.finance_journal_lines(transaction_id,entry_id,account_id,direction,amount_minor)
                SELECT $1,$2,id,'debit',100 FROM public.finance_accounts WHERE code='cash_on_hand'
            ''', entry['transaction_id'], entry['id'])
            assert inserted == 'INSERT 0 1'
    assert await conn.fetchval('SELECT count(*) FROM public.finance_journal_entries') == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [None, 'download', 'rehearsal'])
async def test_native_release_requires_offsite_restore_before_production(
    source: str, pg_bin: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str | None,
) -> None:
    storage = FileStorage(tmp_path/'offsite', corrupt=failure == 'download')
    monkeypatch.setenv('DATABASE_URL', source)
    monkeypatch.delenv('ACADEMY_MIGRATION_DATABASE_URL', raising=False)
    monkeypatch.setenv('R2_ENDPOINT', f'https://{ACCOUNT}.r2.cloudflarestorage.com')
    monkeypatch.setenv('ACADEMY_BACKUP_KEY', os.urandom(32).hex())
    monkeypatch.setattr(release, '_client', lambda: (storage, 'fixture'))
    # These two adapters are the only production identity/TLS replacements.
    # PostgreSQL dump, upload/download, authenticated restore and DDL remain real.
    monkeypatch.setattr(release, 'connection_settings', lambda value: (value, False))
    monkeypatch.setattr(release, 'validate_target', lambda value, project: '127.0.0.1')
    conn = await asyncpg.connect(source)
    try:
        if failure == 'rehearsal':
            await conn.execute('ALTER TABLE reading_attempts RENAME COLUMN submitted_at TO previous_submitted_at')
        before = await release.snapshot_state(conn)
        if failure:
            with pytest.raises(ValueError):
                await release.release(PROJECT, ACCOUNT, 'fixture', pg_bin)
            assert await conn.fetchval("SELECT to_regclass('la_academy_migrations.applied')") is None
            assert await conn.fetchval("SELECT to_regclass('public.finance_accounts')") is None
            assert await release.snapshot_state(conn) == before
        else:
            report = await release.release(PROJECT, ACCOUNT, 'fixture', pg_bin)
            assert report['result'] == 'applied'
            assert report['restore_rehearsal'] == 'passed'
            assert report['verification']['migrations'] == 17
            assert report['verification']['finance_accounts'] == 12
            assert report['verification']['direct_api_grants'] == 0
            assert report['verification']['unbalanced_entries'] == 0
            after = await release.snapshot_state(conn)
            assert all(after['tables'][name] == count for name, count in before['tables'].items())
            assert (await release.release(PROJECT, ACCOUNT, 'fixture', pg_bin))['result'] == 'already_applied'
            assert storage.uploads == 1
            archive = storage.root/report['backup_object']
            assert archive.read_bytes().startswith(release.recovery.MAGIC)
            manifest = json.loads(Path(str(archive)+'.json').read_text())
            assert manifest['source_state'] == before
            assert len(manifest['migration_hashes']) == 17
            assert os.environ['ACADEMY_BACKUP_KEY'] not in json.dumps(manifest)
            await assert_trigger_boundaries(conn)
    finally:
        await conn.close()


@pytest.mark.parametrize('dsn', [
    'postgresql://postgres:secret@db.otherproject.supabase.co/postgres',
    f'postgresql://postgres.{PROJECT}:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
    f'postgresql://postgres:secret@db.{PROJECT}.supabase.co/another_database',
    f'postgresql://postgres:secret@db.{PROJECT}.supabase.co/postgres?sslmode=disable',
    'postgresql://postgres:secret@127.0.0.1/postgres',
])
def test_identity_rejects_wrong_project_transaction_pooler_or_options(dsn: str) -> None:
    with pytest.raises(ValueError):
        release.validate_target(dsn, PROJECT)


def test_expected_direct_and_session_connections() -> None:
    for dsn in (
        f'postgresql://postgres:secret@db.{PROJECT}.supabase.co/postgres',
        f'postgresql://postgres.{PROJECT}:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    ):
        assert release.validate_target(dsn, PROJECT)


def test_invalid_snapshot_is_rejected_before_dump(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match='snapshot'):
        release.recovery.backup_db('unused', 'unused', tmp_path/'backup', tmp_path/'key', snapshot=';unsafe')


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', [None, 'download', 'rehearsal'])
async def test_payment_release_restores_existing_journal_and_cash_before_new_schema(
    source: str, pg_bin: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str | None,
) -> None:
    from app import tuition_ledger as ledger
    storage = FileStorage(tmp_path/'offsite', corrupt=failure == 'download')
    monkeypatch.setenv('DATABASE_URL', source)
    monkeypatch.delenv('ACADEMY_MIGRATION_DATABASE_URL', raising=False)
    monkeypatch.setenv('R2_ENDPOINT', f'https://{ACCOUNT}.r2.cloudflarestorage.com')
    monkeypatch.setenv('ACADEMY_BACKUP_KEY', os.urandom(32).hex())
    monkeypatch.setattr(release, '_client', lambda: (storage, 'fixture'))
    monkeypatch.setattr(release, 'connection_settings', lambda value: (value, False))
    monkeypatch.setattr(release, 'validate_target', lambda value, project: '127.0.0.1')
    conn = await asyncpg.connect(source)
    try:
        await release.upgrade(conn, apply=True)
        actor = await conn.fetchval("INSERT INTO users(name,role,account_status) VALUES('Cashier','admin','active') RETURNING id")
        student = await conn.fetchval("SELECT id FROM users WHERE role='student' LIMIT 1")
        payment, _, _ = await ledger.record_payment(conn, actor_user_id=actor, student_user_id=student,
            amount_minor=137531, idempotency_key='pre-feature-money')
        if failure == 'rehearsal':
            await conn.execute('ALTER FUNCTION finance_journal_immutable_guard() RENAME TO held_immutable_guard')
        schemas = release.SCHEMAS + ('la_academy_migrations',)
        before = await release.snapshot_state(conn, schemas)
        if failure:
            with pytest.raises((ValueError, asyncpg.UndefinedFunctionError)):
                await release.release(PROJECT, ACCOUNT, 'fixture', pg_bin, scope='payments')
            assert await conn.fetchval("SELECT to_regclass('public.tuition_payment_intents')") is None
            assert await conn.fetchval("SELECT to_regclass('la_payments_migrations.applied')") is None
            assert await release.snapshot_state(conn, schemas) == before
        else:
            report = await release.release(PROJECT, ACCOUNT, 'fixture', pg_bin, scope='payments')
            assert report['result'] == 'applied' and report['restore_rehearsal'] == 'passed'
            assert report['verification']['feature_migrations'] == 2
            assert report['verification']['feature_rls_tables'] == 6
            assert report['verification']['feature_direct_api_grants'] == 0
            assert report['verification']['feature_direct_function_grants'] == 0
            assert await conn.fetchval('SELECT count(*) FROM la_academy_migrations.applied') == 17
            assert await conn.fetchval('SELECT count(*) FROM la_payments_migrations.applied') == 1
            assert await conn.fetchval('SELECT count(*) FROM la_prepaid_migrations.applied') == 1
            assert (await conn.fetchrow('SELECT * FROM tuition_payments WHERE id=$1', payment['id']))['amount_minor'] == 137531
            assert (await ledger.student_position(conn, student))['advanceMinor'] == 137531
            manifest = json.loads(Path(str(storage.root/report['backup_object'])+'.json').read_text())
            assert 'la_academy_migrations' in manifest['backup']['schemas']
            assert len(manifest['migration_hashes']) == 2
            assert (await release.release(PROJECT, ACCOUNT, 'fixture', pg_bin, scope='payments'))['result'] == 'already_applied'
            assert storage.uploads == 1
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_second_feature_failure_rolls_back_both_migrations(source: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import migrate_prepaid_services as prepaid
    conn = await asyncpg.connect(source)
    try:
        await release.upgrade(conn, apply=True)
        broken = tmp_path/prepaid.SQL.name
        broken.write_text(prepaid.SQL.read_text() + '\nSELECT 1/0;\n')
        monkeypatch.setattr(prepaid, 'SQL', broken)
        with pytest.raises(asyncpg.DivisionByZeroError):
            await feature.upgrade(conn, apply=True)
        assert await conn.fetchval("SELECT to_regclass('public.tuition_payment_intents')") is None
        assert await conn.fetchval("SELECT to_regclass('public.tuition_service_policies')") is None
        assert await conn.fetchval("SELECT to_regclass('la_payments_migrations.applied')") is None
        assert await conn.fetchval('SELECT count(*) FROM la_academy_migrations.applied') == 17
    finally:
        await conn.close()


@pytest.mark.parametrize('schemas', [('public','auth'), (), ('public','public'), ('public','public;DROP TABLE users')])
def test_backup_schema_scope_refuses_platform_or_unvalidated_names(tmp_path: Path, schemas: tuple[str, ...]) -> None:
    with pytest.raises(ValueError, match='schemas'):
        release.recovery.backup_db('unused','unused',tmp_path/'backup',tmp_path/'key',schemas=schemas)
