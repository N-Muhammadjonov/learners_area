"""Inspect/apply the isolated payment feature migration; never rerun historical SQL."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
from pathlib import Path

import asyncpg

from app.db import connection_settings
from migrate_academy import target_label

SQL=Path(__file__).with_name('migrations')/'20261115200716_academy_self_service_payments.sql'
JOURNAL='la_payments_migrations.applied'
TABLES={'tuition_payment_intents','tuition_provider_events'}


async def upgrade(conn: asyncpg.Connection, *, apply: bool=False) -> dict:
    digest=hashlib.sha256(SQL.read_bytes()).hexdigest()
    async with conn.transaction(readonly=not apply):
        await conn.execute("SET LOCAL search_path TO public,pg_catalog")
        await conn.execute("SET LOCAL lock_timeout TO '5s'")
        await conn.execute("SET LOCAL statement_timeout TO '120s'")
        if apply:await conn.execute('SELECT pg_advisory_xact_lock(357672,20261115)')
        installed={r['relname'] for r in await conn.fetch("""SELECT c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'""")}
        if not {'users','guardian_links','tuition_payments','finance_journal_entries'}<=installed:
            raise ValueError('Academy/Tuition foundation must already be installed')
        journal=await conn.fetchval('SELECT to_regclass($1)',JOURNAL)
        saved=await conn.fetch(f'SELECT name,sha256 FROM {JOURNAL} ORDER BY name') if journal else []
        if saved:
            if len(saved)!=1 or tuple(saved[0])!=(SQL.name,digest) or not TABLES<=installed:
                raise ValueError('Payment migration history, checksum or installed schema differs')
            return {'migration':SQL.name,'sha256':digest,'pending':False,'applied':False}
        if TABLES&installed:raise ValueError('Payment tables exist without the recorded feature migration')
        if apply:
            await conn.execute('CREATE SCHEMA la_payments_migrations')
            await conn.execute('REVOKE ALL ON SCHEMA la_payments_migrations FROM PUBLIC')
            await conn.execute(f'CREATE TABLE {JOURNAL}(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())')
            await conn.execute('REVOKE ALL ON '+JOURNAL+' FROM PUBLIC')
            await conn.execute('ALTER TABLE '+JOURNAL+' ENABLE ROW LEVEL SECURITY')
            await conn.execute(SQL.read_text())
            await conn.execute(f'INSERT INTO {JOURNAL}(name,sha256) VALUES($1,$2)',SQL.name,digest)
        return {'migration':SQL.name,'sha256':digest,'pending':True,'applied':apply}


async def run(dsn: str, *, apply: bool) -> dict:
    dsn,tls=connection_settings(dsn)
    conn=await asyncpg.connect(dsn,ssl=tls,timeout=15)
    try:return await upgrade(conn,apply=apply)
    finally:await conn.close()


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',metavar='EXACT_TARGET',help='apply to the exact inspected host/user/database label')
    args=parser.parse_args()
    dsn=os.getenv('PAYMENTS_MIGRATION_DATABASE_URL','')
    label=target_label(dsn)
    if args.apply and args.apply!=label:parser.error('--apply must match the inspected target label exactly')
    import json
    print(json.dumps({'target':label,**asyncio.run(run(dsn,apply=bool(args.apply)))},sort_keys=True))


if __name__=='__main__':main()
