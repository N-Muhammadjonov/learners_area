"""Guarded Academy release: encrypted offsite backup, local restore, atomic upgrade.

Run as a Railway pre-deploy command, never from an HTTP request. A failed backup,
restore, checksum, rehearsal or invariant stops the release before production DDL.
Only sanitized receipts are written to stdout. No provider messages are sent.
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import pwd
import re
import socket
import subprocess
import tempfile
from typing import Any, Iterator
from urllib.parse import unquote, urlsplit

import asyncpg

from app.db import connection_settings
from app.step19_storage import _client
from migrate_academy import migration_files, upgrade
from tools import recovery_backup as recovery

SCHEMAS = ('public', 'drizzle')


def identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def validate_target(dsn: str, project: str) -> str:
    if not re.fullmatch(r'[a-z]{20}', project):
        raise ValueError('Invalid expected Supabase project')
    parsed = urlsplit(dsn)
    host = parsed.hostname or ''
    user = unquote(parsed.username or '')
    direct = host == f'db.{project}.supabase.co' and user == 'postgres'
    pooled = host.endswith('.pooler.supabase.com') and user == f'postgres.{project}'
    if (parsed.scheme not in ('postgres', 'postgresql') or not (direct or pooled)
            or (parsed.port or 5432) != 5432 or parsed.path != '/postgres'
            or not parsed.password or parsed.fragment or parsed.query):
        raise ValueError('Expected this project on a verified direct/session connection')
    return host


async def snapshot_state(conn: asyncpg.Connection, schemas: tuple[str, ...] = SCHEMAS) -> dict[str, Any]:
    tables = await conn.fetch("""
        SELECT n.nspname AS schema, c.relname AS name, c.relrowsecurity AS rls
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=ANY($1::text[]) AND c.relkind IN ('r','p') ORDER BY 1,2
    """, list(schemas))
    parts = []
    for index, row in enumerate(tables):
        parts.append(f'SELECT {index} AS index, count(*) AS count FROM '
                     f'{identifier(row["schema"])}.{identifier(row["name"])}')
    counts = await conn.fetch(' UNION ALL '.join(parts)) if parts else []
    return {
        'tables': {tables[row['index']]['schema']+'.'+tables[row['index']]['name']: row['count']
                   for row in counts},
        'rls': {row['schema']+'.'+row['name']: row['rls'] for row in tables},
        'constraints': await conn.fetchval("""
            SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
            WHERE n.nspname=ANY($1::text[])
        """, list(schemas)),
    }


async def verify_upgrade(conn: asyncpg.Connection) -> dict[str, Any]:
    if await upgrade(conn, apply=False):
        raise ValueError('Upgrade journal is incomplete')
    tables = sorted({name for _, _, sql in migration_files()
                     for name in re.findall(r'^CREATE TABLE IF NOT EXISTS ([a-z_]+)\s*\(', sql, re.MULTILINE)})
    protected = await conn.fetchval("""
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relrowsecurity
    """, tables)
    if protected != len(tables):
        raise ValueError('Managed tables are missing RLS')
    grants = await conn.fetchval("""
        SELECT count(*) FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name=ANY($1::text[])
          AND grantee IN ('PUBLIC','anon','authenticated','service_role')
    """, tables)
    if grants:
        raise ValueError('Managed tables expose direct API grants')
    unbalanced = await conn.fetchval("""
        SELECT count(*) FROM (
            SELECT e.id FROM finance_journal_entries e
            LEFT JOIN finance_journal_lines l ON l.entry_id=e.id
            GROUP BY e.id, l.currency_code HAVING count(l.id)=0
              OR coalesce(sum(l.amount_minor) FILTER(WHERE l.direction='debit'),0)
                <>coalesce(sum(l.amount_minor) FILTER(WHERE l.direction='credit'),0)
        ) broken
    """)
    if unbalanced:
        raise ValueError('Finance journal does not balance')
    accounts = await conn.fetchval('SELECT count(*) FROM finance_accounts')
    if accounts < 12:
        raise ValueError('Standard finance accounts are missing')
    return {'migrations': len(migration_files()), 'managed_tables': len(tables),
            'rls_tables': protected, 'direct_api_grants': grants,
            'unbalanced_entries': unbalanced, 'finance_accounts': accounts}


@contextmanager
def local_database(base: Path, pg_bin: Path) -> Iterator[str]:
    """Create an ephemeral, loopback-only database and always stop its server."""
    identity = pwd.getpwnam('postgres') if os.geteuid() == 0 else pwd.getpwuid(os.getuid())
    if os.geteuid() == 0:
        os.chown(base, 0, identity.pw_gid)
        base.chmod(0o750)
    data = base/'postgres'
    for directory in (data,):
        directory.mkdir(mode=0o700)
        if os.geteuid() == 0:
            os.chown(directory, identity.pw_uid, identity.pw_gid)

    def demote() -> None:
        os.setgroups([])
        os.setgid(identity.pw_gid)
        os.setuid(identity.pw_uid)

    def command(*arguments: str) -> None:
        subprocess.run(list(arguments), check=True, timeout=120,
                       env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'},
                       preexec_fn=demote if os.geteuid() == 0 else None,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    with socket.socket() as available:
        available.bind(('127.0.0.1', 0))
        port = available.getsockname()[1]
    command(str(pg_bin/'initdb'), '-D', str(data), '-U', 'recovery_owner',
            '-A', 'trust', '--no-locale', '--encoding=UTF8')
    started = False
    try:
        command(str(pg_bin/'pg_ctl'), '-D', str(data), '-l', str(data/'server.log'),
                '-w', '-o', f"-h 127.0.0.1 -p {port} -k '' "
                '-c max_connections=10 -c shared_buffers=16MB', 'start')
        started = True
        yield f'postgresql://recovery_owner@127.0.0.1:{port}/learners_recovery_academy'
    finally:
        if started or (data/'postmaster.pid').exists():
            command(str(pg_bin/'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', 'stop')


async def prepare_local(dsn: str, roles: list[str]) -> None:
    admin = await asyncpg.connect(dsn.rsplit('/', 1)[0]+'/postgres')
    try:
        for role in roles:
            if not await admin.fetchval('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)', role):
                await admin.execute(f'CREATE ROLE {identifier(role)} NOLOGIN')
        await admin.execute('CREATE DATABASE learners_recovery_academy')
    finally:
        await admin.close()


def upload_backup(client: Any, bucket: str, archive: Path, key: str, sha256: str) -> None:
    client.upload_file(str(archive), bucket, key, ExtraArgs={
        'ContentType': 'application/octet-stream',
        'Metadata': {'sha256': sha256, 'encryption': 'LA-BACKUP-GCM1'},
    })
    downloaded = archive.with_name('downloaded.labak')
    client.download_file(bucket, key, str(downloaded))
    if recovery.digest_file(downloaded) != sha256:
        raise ValueError('Offsite backup checksum differs')
    downloaded.unlink()


async def release(project: str, account: str, bucket: str, pg_bin: Path, *, scope: str = 'academy') -> dict[str, Any]:
    if scope not in ('academy', 'payments'):
        raise ValueError('Unknown migration scope')
    inspect_upgrade, check_upgrade, files = upgrade, verify_upgrade, migration_files
    if scope == 'payments':
        from tools import payments_release_plan as feature
        inspect_upgrade, check_upgrade, files = feature.upgrade, feature.verify_upgrade, feature.migration_files
    raw_dsn = os.environ.get('ACADEMY_MIGRATION_DATABASE_URL') or os.environ['DATABASE_URL']
    dsn, tls = connection_settings(raw_dsn)
    host = validate_target(dsn, project)
    if tls is None:
        raise ValueError('Verified TLS is required')
    print(json.dumps({'event': 'academy_database_target_validated'}), flush=True)
    conn = await asyncpg.connect(dsn, ssl=tls, timeout=15, command_timeout=120)
    try:
        print(json.dumps({'event': 'academy_database_connected'}), flush=True)
        pending = await inspect_upgrade(conn, apply=False)
        if not pending:
            return {'result': 'already_applied', 'verification': await check_upgrade(conn)}
        schemas = SCHEMAS
        if scope == 'payments':
            journals = await conn.fetch('''SELECT nspname FROM pg_namespace
                WHERE nspname=ANY($1::text[]) ORDER BY nspname''',
                ['la_academy_migrations','la_payments_migrations','la_prepaid_migrations'])
            schemas = SCHEMAS + tuple(row['nspname'] for row in journals)
        endpoint = os.environ.get('R2_ENDPOINT', '').rstrip('/')
        if endpoint != f'https://{account}.r2.cloudflarestorage.com':
            raise ValueError('Unexpected R2 account')
        client, configured_bucket = _client()
        if configured_bucket != bucket:
            raise ValueError('Unexpected backup bucket')
        key_hex = os.environ.get('ACADEMY_BACKUP_KEY', '')
        if not re.fullmatch(r'[0-9a-f]{64}', key_hex):
            raise ValueError('Separate persistent ACADEMY_BACKUP_KEY is required')
        print(json.dumps({'event': 'academy_storage_target_validated'}), flush=True)
        os.environ['BACKUP_CA_FILE'] = os.environ.get('SUPABASE_CA_FILE') or str(
            Path(__file__).resolve().parents[1]/'app/supabase_root_ca.pem')
        with tempfile.TemporaryDirectory(prefix='la-academy-release-') as workspace:
            base = Path(workspace)
            key_dir = base/'keys'
            key_dir.mkdir(mode=0o700)
            key_file = key_dir/'key'
            key_file.write_bytes(bytes.fromhex(key_hex))
            key_file.chmod(0o600)
            archive = base/'encrypted'/'application.labak'
            async with conn.transaction(isolation='serializable', readonly=True, deferrable=True):
                state = await snapshot_state(conn, schemas)
                roles = [row['rolname'] for row in await conn.fetch(
                    "SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname")]
                exported = await conn.fetchval('SELECT pg_export_snapshot()')
                print(json.dumps({'event': 'academy_backup_snapshot_exported'}), flush=True)
                receipt = await asyncio.to_thread(recovery.backup_db, dsn, host, archive,
                    key_file, str(pg_bin/'pg_dump'), snapshot=exported, schemas=schemas)
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            object_key = f'operational-backups/academy/{project}/{stamp}-{receipt["sha256"]}.labak'
            await asyncio.to_thread(upload_backup, client, bucket, archive, object_key, receipt['sha256'])
            print(json.dumps({'event': 'academy_backup_uploaded', 'sha256': receipt['sha256'],
                              'encrypted_bytes': receipt['encrypted_bytes']}), flush=True)
            print(json.dumps({'event': 'academy_restore_rehearsal_started'}), flush=True)
            with local_database(base, pg_bin) as local_dsn:
                await prepare_local(local_dsn, roles)
                await asyncio.to_thread(recovery.restore_db, local_dsn, archive, key_file,
                                        receipt['sha256'], str(pg_bin/'pg_restore'))
                local = await asyncpg.connect(local_dsn, command_timeout=120)
                try:
                    if await snapshot_state(local, schemas) != state:
                        raise ValueError('Restored row counts, constraints or RLS differ from backup snapshot')
                    await inspect_upgrade(local, apply=True)
                    rehearsal = await check_upgrade(local)
                finally:
                    await local.close()
            manifest = {'project': project, 'bucket': bucket, 'object_key': object_key,
                        'backup': receipt, 'source_state': state, 'roles': roles,
                        'rehearsal': rehearsal, 'encryption_key_variable': 'ACADEMY_BACKUP_KEY',
                        'migration_hashes': {name: digest for name, digest, _ in files()}}
            await asyncio.to_thread(client.put_object, Bucket=bucket, Key=object_key+'.json',
                                    Body=json.dumps(manifest, sort_keys=True).encode(),
                                    ContentType='application/json')
            print(json.dumps({'event': 'academy_restore_rehearsal_passed', **rehearsal}), flush=True)
            async with conn.transaction(isolation='repeatable_read'):
                before = await snapshot_state(conn, schemas)
                await inspect_upgrade(conn, apply=True)
                verification = await check_upgrade(conn)
                after = await snapshot_state(conn, schemas)
                if any(after['tables'].get(table) != count for table, count in before['tables'].items()):
                    raise ValueError('Existing table row counts changed during the upgrade')
            return {'result': 'applied', 'project': project, 'backup_object': object_key,
                    'backup_sha256': receipt['sha256'], 'restore_rehearsal': 'passed',
                    'preserved_tables': len(before['tables']), 'verification': verification}
    finally:
        await conn.close()


def main() -> None:
    print(json.dumps({'event': 'academy_release_started'}), flush=True)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    parser.add_argument('--account', required=True)
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--pg-bin', type=Path, default=Path('/usr/lib/postgresql/17/bin'))
    parser.add_argument('--scope', choices=('academy','payments'), default='academy')
    args = parser.parse_args()
    try:
        report = asyncio.run(release(args.project, args.account, args.bucket, args.pg_bin, scope=args.scope))
        print(json.dumps({'event': 'academy_release_complete', **report}), flush=True)
    except Exception as exc:
        # SQL, DSNs, object credentials and student data must never enter logs.
        print(json.dumps({'event': 'academy_release_failed', 'error_type': type(exc).__name__}), flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
