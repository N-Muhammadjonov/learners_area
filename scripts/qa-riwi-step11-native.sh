#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$project_dir"
expected_base=c133f97cabc086fdd14b9acb7f60c46a1cc92419
if [ "$(git rev-parse HEAD)" != "$expected_base" ]; then
  printf '%s\n' 'Base changed; stop and reconcile before running this checkpoint.' >&2
  exit 1
fi
qa_logs=$(mktemp -d /tmp/riwi-step11-native-qa-XXXXXX)
printf 'Native QA logs: %s\n' "$qa_logs"
run_gate() {
  local gate_name="$1"
  shift
  "$@" 2>&1 | tee "$qa_logs/$gate_name.log"
}
run_gate backend node --max-old-space-size=2048 --conditions=react-server --import tsx --test --test-concurrency=1 tests/*.test.ts
run_gate ui npm run test:ui
run_gate typecheck npm run typecheck
run_gate lint npm run lint
git diff --check
printf 'Non-build QA gates passed. Build was not rerun under owner instruction. This script does not commit or push. Logs: %s\n' "$qa_logs"
