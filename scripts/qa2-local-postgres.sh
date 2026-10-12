#!/usr/bin/env bash
# Deterministic, isolated REAL PostgreSQL for the QA2 gates (never Preview/Production).
#
#   bash scripts/qa2-local-postgres.sh          # start server, recreate learners_qa2, migrate, seed
#   bash scripts/qa2-local-postgres.sh stop     # stop the server
#
# Binary: official embedded-postgres npm build (downloaded under QA2_PG_DIR, not a project
# dependency). The database is dropped and recreated on every run, so re-runs are safe and
# never depend on earlier state. Fixtures are reserved `.invalid` identities (no real users).
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
DIR=${QA2_PG_DIR:-/tmp/qa2-pg}
PORT=5432
export QA2_DATABASE_URL="postgres://postgres@localhost:${PORT}/learners_qa2"
export LD_LIBRARY_PATH=$DIR/package/native/lib
export DYLD_LIBRARY_PATH=$DIR/package/native/lib
PGCTL="$DIR/package/native/bin/pg_ctl"

if [ "${1:-}" = "stop" ]; then
  [ -x "$PGCTL" ] && "$PGCTL" -D "$DIR/data" stop -m fast >/dev/null 2>&1 || true
  echo "qa2 postgres stopped"; exit 0
fi

# An owner-started native server may be reachable over TCP while process-status
# inspection is denied by the host sandbox. Reuse it explicitly; never signal it.
if [ "${QA2_PG_EXTERNAL:-0}" != "1" ]; then
mkdir -p "$DIR"
if [ ! -x "$DIR/package/native/bin/postgres" ]; then
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64) package_name=darwin-arm64 ;;
    Darwin/x86_64) package_name=darwin-x64 ;;
    Linux/x86_64) package_name=linux-x64 ;;
    Linux/aarch64) package_name=linux-arm64 ;;
    *) echo "Unsupported real-PostgreSQL QA platform" >&2; exit 1 ;;
  esac
  (cd "$DIR" && npm pack -q "@embedded-postgres/$package_name" --cache "$DIR/npm-cache" >/dev/null && tar xzf embedded-postgres-"$package_name"-*.tgz)
  (cd "$DIR" && python3 - <<'P'
import json, os
for it in json.load(open('package/native/pg-symlinks.json')):
    t = 'package/' + it['target']
    if not os.path.exists(t): os.symlink(os.path.basename(it['source']), t)
P
  )
fi
[ -d "$DIR/data" ] || "$DIR/package/native/bin/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null

# scripts/measure-scale.mjs and scripts/measure-unbounded-reads.mjs count real queries through
# pg_stat_statements; both fail closed without it rather than invent numbers. The embedded-postgres
# build does ship the contrib module (lib/postgresql/pg_stat_statements.so), it is just not
# preloaded, so enable it here instead of leaving §10 measurements dependent on a hand-edited
# postgresql.conf that any environment rebuild wipes.
QA2_CONF="$DIR/data/postgresql.conf"
QA2_PG_NEEDS_RESTART=0
if ! grep -q "^shared_preload_libraries = 'pg_stat_statements'" "$QA2_CONF"; then
  printf "\n# Enabled for the §10 performance probes (query counts, rows read, db time).\nshared_preload_libraries = 'pg_stat_statements'\npg_stat_statements.max = 10000\npg_stat_statements.track = all\n" >>"$QA2_CONF"
  QA2_PG_NEEDS_RESTART=1
fi

if ! "$PGCTL" -D "$DIR/data" status >/dev/null 2>&1; then
  "$PGCTL" -D "$DIR/data" -l "$DIR/log" -w -o "-p ${PORT} -k /tmp -c listen_addresses=localhost" start >/dev/null
elif [ "$QA2_PG_NEEDS_RESTART" = "1" ]; then
  # shared_preload_libraries only takes effect on a restart. Stop and start separately: a chained
  # `pg_ctl restart -w` has hung here before.
  "$PGCTL" -D "$DIR/data" stop -m fast >/dev/null 2>&1 || true
  "$PGCTL" -D "$DIR/data" -l "$DIR/log" -w -o "-p ${PORT} -k /tmp -c listen_addresses=localhost" start >/dev/null
fi

fi

cd "$REPO"
# Guard + fresh database + full journal + fixtures, all through the same localhost-only guard.
node --input-type=module - <<'JS'
import pg from "pg";
import { readFileSync } from "node:fs";
import { assertIsolatedTarget } from "./scripts/qa2-seed-fixtures.mjs";
assertIsolatedTarget(process.env.QA2_DATABASE_URL);
const admin = new pg.Client({ connectionString: process.env.QA2_DATABASE_URL.replace(/\/learners_qa2$/, "/postgres") });
await admin.connect();
const native = (await admin.query("select current_setting('server_version_num')::int version")).rows[0];
if (native.version < 150000) throw new Error("Native QA PostgreSQL 15+ is required");
await admin.query("drop database if exists learners_qa2 with (force)");
await admin.query("create database learners_qa2");
await admin.end();
JS
DATABASE_URL="$QA2_DATABASE_URL" npx drizzle-kit migrate >"$DIR/migrate.log" 2>&1 || { cat "$DIR/migrate.log"; exit 1; }
# The database is dropped and recreated on every run, so the extension is recreated every run too.
DATABASE_URL="$QA2_DATABASE_URL" node --input-type=module - <<'JS'
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("create extension if not exists pg_stat_statements");
const installed = (await client.query(
  "select extversion from pg_extension where extname='pg_stat_statements'",
)).rows[0];
if (!installed) throw new Error("pg_stat_statements is not installed — the §10 measurement probes would fail closed");
console.log(`pg_stat_statements ${installed.extversion} ready`);
await client.end();
JS
DATABASE_URL="$QA2_DATABASE_URL" node --input-type=module - <<'JS'
import pg from "pg";
import { readFileSync } from "node:fs";
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries.length;
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query("select count(*)::int n from drizzle.__drizzle_migrations");
await c.end();
if (rows[0].n !== journal) { console.error(`migration mismatch: applied ${rows[0].n} / journal ${journal}`); process.exit(1); }
console.log(`migrations ok: ${rows[0].n} / ${journal}`);
JS
DATABASE_URL="$QA2_DATABASE_URL" node scripts/qa2-seed-fixtures.mjs
echo "ready: DATABASE_URL=$QA2_DATABASE_URL"
