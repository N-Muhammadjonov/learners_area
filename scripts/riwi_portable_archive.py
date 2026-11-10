#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "services" / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.riwi_portability import create_portable_archive, import_portable_archive


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="RIWI Portable Archive CLI (Modes A/B/C)")
    sub = parser.add_subparsers(dest="command", required=True)

    exp = sub.add_parser("export")
    exp.add_argument("--mode", choices=["A", "B", "C"], required=True)
    exp.add_argument("--input-json", required=True)
    exp.add_argument("--output", required=True)

    imp = sub.add_parser("import")
    imp.add_argument("--archive", required=True)
    imp.add_argument("--apply", action="store_true", help="Apply validated archive (default is safe dry-run)")

    args = parser.parse_args(argv)
    key_b64 = os.environ.get("RIWI_PORTABLE_ENCRYPTION_KEY_B64")

    if args.command == "export":
        data = json.loads(Path(args.input_json).read_text(encoding="utf-8"))
        archive = create_portable_archive(mode=args.mode, tables_data=data, encryption_key_b64=key_b64)
        Path(args.output).write_text(json.dumps(archive, indent=2), encoding="utf-8")
        print(json.dumps({"ok": True, "mode": args.mode, "output": args.output}))
        return 0

    archive = json.loads(Path(args.archive).read_text(encoding="utf-8"))
    res = import_portable_archive(archive, dry_run=not args.apply, encryption_key_b64=key_b64)
    print(json.dumps(res, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
