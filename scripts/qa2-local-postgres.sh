#!/usr/bin/env bash
# Start a throwaway, isolated REAL PostgreSQL for the QA2 gates (never Preview/Production).
# Binary: official embedded-postgres npm build (downloaded to /tmp, not a project dependency).
set -euo pipefail
DIR=${QA2_PG_DIR:-/tmp/qa2-pg}
mkdir -p "$DIR" && cd "$DIR"
if [ ! -x package/native/bin/postgres ]; then
  npm pack -q @embedded-postgres/linux-x64 >/dev/null && tar xzf embedded-postgres-linux-x64-*.tgz
  python3 - <<'P'
import json, os
for it in json.load(open('package/native/pg-symlinks.json')):
    t = 'package/' + it['target']
    if not os.path.exists(t): os.symlink(os.path.basename(it['source']), t)
P
fi
export LD_LIBRARY_PATH=$DIR/package/native/lib
[ -d data ] || package/native/bin/initdb -D data -U postgres --auth=trust >/dev/null
package/native/bin/pg_ctl -D data -l log -o "-p 5432 -k /tmp -c listen_addresses=localhost" start
echo "Now: create database learners_qa2; DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 npx drizzle-kit migrate;"
echo "insert one active owner and one active student fixture; then:"
echo "QA2_DATABASE_TESTS=1 STORAGE_PROVIDER=local DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 npm test"
