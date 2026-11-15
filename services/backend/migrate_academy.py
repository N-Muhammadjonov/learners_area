"""Inspect or apply only the Academy and Tuition upgrade to an existing database."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

import asyncpg

from app.db import connection_settings

MIGRATIONS = Path(__file__).resolve().with_name('migrations')
VERSIONS = range(1115, 1132)
JOURNAL = 'la_academy_migrations.applied'
BASE_TABLES = (
    'users', 'courses', 'enrollments', 'audit_log', 'assignment_targets', 'assignments',
    'teacher_student_links', 'reading_attempts', 'listening_attempts', 'speaking_attempts',
    'writing_submissions', 'writing_feedback', 'guardian_profiles', 'guardian_links',
)
Migration = tuple[str, str, str]


def migration_files() -> list[Migration]:
    migrations = []
    for version in VERSIONS:
        paths = list(MIGRATIONS.glob(f'{version}_*.sql'))
        if len(paths) != 1:
            raise ValueError(f'Expected exactly one migration for {version}')
        path = paths[0]
        data = path.read_bytes()
        migrations.append((path.name, hashlib.sha256(data).hexdigest(), data.decode('utf-8')))
    return migrations


def target_label(dsn: str) -> str:
    parsed = urlsplit(dsn)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.username:
        raise ValueError('ACADEMY_MIGRATION_DATABASE_URL must name a PostgreSQL host and user')
    if not parsed.path.strip('/') or parsed.port == 6543:
        raise ValueError('Use a direct or session pooler URL that names the database')
    return f'{unquote(parsed.username)}@{parsed.hostname}:{parsed.port or 5432}{parsed.path}'


async def upgrade(conn: asyncpg.Connection, *, apply: bool) -> list[str]:
    migrations = migration_files()
    async with conn.transaction(readonly=not apply):
        await conn.execute("SET LOCAL search_path TO public, pg_catalog")
        await conn.execute("SET LOCAL lock_timeout TO '5s'")
        await conn.execute("SET LOCAL statement_timeout TO '120s'")
        if apply:
            await conn.execute("SELECT pg_advisory_xact_lock(357672, 1115)")
        relations = {row['name'] for row in await conn.fetch("""
            SELECT c.relname AS name FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind IN ('r', 'p')
        """)}
        missing = set(BASE_TABLES) - relations
        if missing:
            raise ValueError('Missing prerequisite tables: ' + ', '.join(sorted(missing)))
        journal_exists = bool(await conn.fetchval('SELECT to_regclass($1)', JOURNAL))
        saved = await conn.fetch(f'SELECT name, sha256 FROM {JOURNAL} ORDER BY name') if journal_exists else []
        expected = [(name, digest) for name, digest, _ in migrations]
        if [tuple(row) for row in saved] != expected[:len(saved)]:
            raise ValueError('Academy migration history or checksums differ from this checkout')
        managed_tables = {
            name for _, _, sql in migrations
            for name in re.findall(r'^CREATE TABLE IF NOT EXISTS ([a-z_]+)\s*\(', sql, re.MULTILINE)
        }
        if not saved and managed_tables & relations:
            raise ValueError('Academy tables already exist without a recorded upgrade')
        if saved and (len(saved) != len(migrations) or managed_tables - relations):
            raise ValueError('Academy upgrade record and installed schema are incomplete')
        pending = migrations[len(saved):]
        if apply and pending:
            await conn.execute('CREATE SCHEMA IF NOT EXISTS la_academy_migrations')
            await conn.execute('REVOKE ALL ON SCHEMA la_academy_migrations FROM PUBLIC')
            await conn.execute(f'''
                CREATE TABLE IF NOT EXISTS {JOURNAL} (
                    name text PRIMARY KEY,
                    sha256 text NOT NULL,
                    applied_at timestamptz NOT NULL DEFAULT now()
                )
            ''')
            for name, digest, sql in pending:
                try:
                    await conn.execute(sql)
                    await conn.execute(f'INSERT INTO {JOURNAL}(name, sha256) VALUES($1, $2)', name, digest)
                except asyncpg.PostgresError as exc:
                    raise ValueError(f'Migration {name} failed ({exc.sqlstate}). Upgrade rolled back.') from exc
        return [name for name, _, _ in pending]


async def run(dsn: str, apply: bool) -> list[str]:
    dsn, tls = connection_settings(dsn)
    conn = await asyncpg.connect(dsn, ssl=tls, timeout=15)
    try:
        return await upgrade(conn, apply=apply)
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', metavar='TARGET', help='apply the printed plan to this exact target')
    args = parser.parse_args()
    dsn = os.getenv('ACADEMY_MIGRATION_DATABASE_URL', '')
    try:
        target = target_label(dsn)
        if args.apply is not None and args.apply != target:
            raise ValueError('The supplied target differs from the configured connection')
        print(f'Target {target}', flush=True)
        pending = asyncio.run(run(dsn, apply=args.apply is not None))
    except ValueError as exc:
        parser.exit(1, f'{exc}\n')
    except (asyncpg.PostgresError, OSError, TimeoutError) as exc:
        parser.exit(1, f'Database operation failed ({type(exc).__name__}).\n')
    if pending:
        print('Applied' if args.apply is not None else 'Pending', *pending, sep='\n')
    else:
        print('All Academy migrations are recorded and installed.')


if __name__ == '__main__':
    main()
