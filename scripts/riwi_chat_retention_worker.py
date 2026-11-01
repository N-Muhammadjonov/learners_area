#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import sys

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
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="RIWI D-01 Chat Retention Scheduled Worker")
    parser.add_argument("--execute", action="store_true", help="Execute hard-delete when RIWI_CHAT_RETENTION_DELETE_ENABLED=true")
    args = parser.parse_args(argv)
    res = asyncio.run(run_retention_worker(execute=args.execute))
    print(json.dumps(res, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
