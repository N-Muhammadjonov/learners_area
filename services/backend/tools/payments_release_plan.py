"""Feature migration plan used by the existing encrypted-backup release gate."""
from __future__ import annotations

import hashlib

import asyncpg

import migrate_academy as academy
import migrate_self_service_payments as payments
import migrate_prepaid_services as prepaid

TABLES = sorted(payments.TABLES | prepaid.TABLES)


def migration_files() -> list[tuple[str, str, str]]:
    return [(path.name, hashlib.sha256(path.read_bytes()).hexdigest(), path.read_text())
            for path in (payments.SQL, prepaid.SQL)]


async def upgrade(conn: asyncpg.Connection, *, apply: bool) -> list[str]:
    if await academy.upgrade(conn, apply=False):
        raise ValueError('Academy foundation must already be installed')
    async with conn.transaction(readonly=not apply):
        payment = await payments.upgrade(conn, apply=apply)
        if payment['pending'] and not apply:
            existing = await conn.fetchval('''SELECT EXISTS(SELECT 1 FROM pg_class c
                JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relname=ANY($1::text[]))''', sorted(prepaid.TABLES))
            if existing or await conn.fetchval("SELECT to_regclass('la_prepaid_migrations.applied')"):
                raise ValueError('Prepaid schema exists before its payment prerequisite')
            return [payments.SQL.name, prepaid.SQL.name]
        service = await prepaid.upgrade(conn, apply=apply)
        return [item['migration'] for item in (payment, service) if item['pending']]


async def verify_upgrade(conn: asyncpg.Connection) -> dict:
    from tools.academy_release import verify_upgrade as verify_foundation
    result = await verify_foundation(conn)
    if await upgrade(conn, apply=False):
        raise ValueError('Payment/prepaid migration journal is incomplete')
    count = await conn.fetchval('''SELECT count(*) FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relrowsecurity''', TABLES)
    grants = await conn.fetchval('''SELECT count(*) FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name=ANY($1::text[])
          AND grantee IN ('PUBLIC','anon','authenticated','service_role')''', TABLES)
    functions = await conn.fetchval('''SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        LEFT JOIN pg_roles r ON r.oid=a.grantee
        WHERE n.nspname='public' AND p.proname=ANY($1::text[]) AND a.privilege_type='EXECUTE'
          AND (a.grantee=0 OR r.rolname IN ('anon','authenticated','service_role'))''',
        ['tuition_intent_guard','tuition_service_policy_guard','tuition_service_binding_guard','tuition_service_pause_guard'])
    if count != len(TABLES) or grants or functions:
        raise ValueError('Payment/prepaid security boundary differs')
    return {**result, 'feature_migrations': 2, 'feature_tables': len(TABLES),
            'feature_rls_tables': count, 'feature_direct_api_grants': grants,
            'feature_direct_function_grants': functions}
