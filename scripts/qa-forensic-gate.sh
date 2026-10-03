#!/usr/bin/env bash
# One reproducible code-level QA gate (no Production, no Preview, no secrets).
#
#   npm run qa:gate
#
# Steps: PGlite unit suite → UI suite (tests/ui/tsconfig.json) → isolated real PG
# (fresh DB, full migration journal, fixtures) → real-PG suite with every source asset the
# repo can reach (speaking bank from arena/reference-materials, sha256-pinned) →
# typecheck → lint → build → git diff --check. Results go to $QA_OUT (default /tmp/qa-gate).
set -uo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd); cd "$REPO"
OUT=${QA_OUT:-/tmp/qa-gate}; mkdir -p "$OUT"
BANK_SHA=c12456756c73fe8ba7ee9e414e43c83ecc1c5e3a21b206e769c64f01e560b4b9
BANK_REF=origin/arena/reference-materials
BANK_PATH=04_speaking_master_bank_880.jsonl
FAIL=0
summary() { # name log exit
  local t p f s
  t=$(grep -E "^# tests " "$2" | tail -1 | awk '{print $3}'); p=$(grep -E "^# pass " "$2" | tail -1 | awk '{print $3}')
  f=$(grep -E "^# fail " "$2" | tail -1 | awk '{print $3}'); s=$(grep -E "^# skipped " "$2" | tail -1 | awk '{print $3}')
  printf '%-22s exit=%s total=%s pass=%s fail=%s skipped=%s\n' "$1" "$3" "${t:--}" "${p:--}" "${f:--}" "${s:--}" | tee -a "$OUT/summary.txt"
  grep -E "# SKIP" "$2" | sed 's/^ *//' | sed "s/^/    skip: /" | tee -a "$OUT/summary.txt" >/dev/null
  [ "$3" = 0 ] || FAIL=1
}
step() { # name command...
  local name=$1; shift
  local start=$(date +%s); "$@" >"$OUT/$name.log" 2>&1; local rc=$?
  printf '%-22s exit=%s (%ss)\n' "$name" "$rc" "$(( $(date +%s) - start ))" | tee -a "$OUT/summary.txt"
  [ "$rc" = 0 ] || FAIL=1
}
: >"$OUT/summary.txt"

npm test >"$OUT/unit.log" 2>&1; summary unit-pglite "$OUT/unit.log" $?
npm run -s test:ui >"$OUT/ui.log" 2>&1; summary ui "$OUT/ui.log" $?

# Speaking bank: materialize the pinned reference asset into the QA output dir (read-only).
git rev-parse -q --verify "$BANK_REF" >/dev/null || git fetch -q origin "arena/reference-materials:refs/remotes/$BANK_REF" || true
if git show "$BANK_REF:$BANK_PATH" >"$OUT/speaking-bank.jsonl" 2>/dev/null \
  && [ "$(sha256sum "$OUT/speaking-bank.jsonl" | cut -d' ' -f1)" = "$BANK_SHA" ]; then
  export SPEAKING_BANK_SOURCE="$OUT/speaking-bank.jsonl"; echo "speaking bank: sha256 ok ($(wc -l <"$SPEAKING_BANK_SOURCE") rows)" | tee -a "$OUT/summary.txt"
else
  echo "speaking bank: UNAVAILABLE (ref or checksum) — bank tests will skip" | tee -a "$OUT/summary.txt"
fi
[ -n "${LISTENING_SOURCE_ZIP:-}" ] || echo "listening source zip: not provided (owner asset) — 2 tests will skip" | tee -a "$OUT/summary.txt"

if bash scripts/qa2-local-postgres.sh >"$OUT/pg-bootstrap.log" 2>&1; then
  tail -3 "$OUT/pg-bootstrap.log" | tee -a "$OUT/summary.txt"
  QA2_DATABASE_TESTS=1 STORAGE_PROVIDER=local DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2 \
    npm test >"$OUT/real-pg.log" 2>&1; summary real-pg "$OUT/real-pg.log" $?
  bash scripts/qa2-local-postgres.sh stop >/dev/null
else
  echo "real-pg bootstrap FAILED (see $OUT/pg-bootstrap.log)" | tee -a "$OUT/summary.txt"; FAIL=1
fi

step typecheck npm run -s typecheck
step lint npm run -s lint
step build npm run -s build
step diff-check git diff --check
# Committed whitespace defects too (working-tree check alone missed EOF blank lines in 3 files).
QA_BASE=${QA_BASE:-0f4a6eaed94da4254789c3c89f8c2871ab96959e}
step diff-check-range git diff --check "$QA_BASE" HEAD -- src tests scripts
echo "GATE $([ $FAIL = 0 ] && echo PASS || echo FAIL) — logs in $OUT" | tee -a "$OUT/summary.txt"
exit $FAIL
