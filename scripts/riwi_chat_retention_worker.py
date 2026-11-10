#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "services" / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.riwi_retention import purge_expired_riwi_conversations


async def run_retention_worker(*, execute: bool = False, conn=None, env=None) -> dict:
    runtime_env = env if env is not None else os.environ
    delete_enabled = str(runtime_env.get("RIWI_CHAT_RETENTION_DELETE_ENABLED") or "false").strip().lower() == "true"
    # Never perform irreversible deletion unless both --execute and RIWI_CHAT_RETENTION_DELETE_ENABLED=true are set
    dry_run = not (execute and delete_enabled)
    result = await purge_expired_riwi_conversations(conn, dry_run=dry_run)
    result["deleteEnabledGate"] = delete_enabled
    result['databaseConnected']=conn is not None
    return result


async def run_connected_worker(args):
    """A scheduled CLI invocation must really connect, never report a no-op as success."""
    dsn=os.environ.get('DATABASE_URL','');expected=args.expected_project_ref
    if not dsn or not expected: raise ValueError('DATABASE_URL and --expected-project-ref are required')
    parts=urlsplit(dsn)
    if parts.hostname!=f'db.{expected}.supabase.co' and parts.username!=f'postgres.{expected}':
        raise ValueError('Retention database target does not match expected project')
    import asyncpg
    from app.db import connection_settings,initialize_connection
    address,tls=connection_settings(dsn)
    conn=await asyncpg.connect(address,ssl=tls,timeout=8,command_timeout=30,statement_cache_size=0)
    try:
        await initialize_connection(conn)
        await conn.fetchval('SELECT count(*) FROM riwi_conversations')
        return await run_retention_worker(execute=args.execute,conn=conn)
    finally: await conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="RIWI seven-day chat retention maintenance")
    parser.add_argument("--execute", action="store_true", help="Execute hard-delete when RIWI_CHAT_RETENTION_DELETE_ENABLED=true")
    parser.add_argument('--expected-project-ref',help='Required Supabase project identity; must match the connection target')
    args = parser.parse_args(argv)
    try: res = asyncio.run(run_connected_worker(args))
    except Exception as exc:
        # Credentials and SQL error details must not leak into scheduler output.
        print(json.dumps({'ok':False,'error':type(exc).__name__,'databaseConnected':False}),file=sys.stderr)
        return 1
    print(json.dumps(res, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
