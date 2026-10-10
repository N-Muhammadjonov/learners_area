#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 4 ]; then
  printf '%s\n' 'Usage: bash qa-riwi-batch15-native.sh PATCH MANIFEST PATCH_SHA256 MANIFEST_SHA256' >&2
  exit 1
fi
patch="$1"
manifest="$2"
test "$(shasum -a 256 "$patch" | awk '{print $1}')" = "$3"
test "$(shasum -a 256 "$manifest" | awk '{print $1}')" = "$4"
cd /tmp/riwi-publish-BIXHDC
expected_base=7f805af85705906f6c37710a3030f3eb357e90c0
branch=arena/01a10bac-learners-area
test "$(git rev-parse HEAD)" = "$expected_base"
test "$(git branch --show-current)" = "$branch"
test "$(git ls-remote origin "refs/heads/$branch" | awk '{print $1}')" = "$expected_base"
# Refuse accidental deployment credentials before any fixture can connect.
node --input-type=module - <<'RIWI_TARGETS'
for (const [name, database] of [['DATABASE_URL','/learners_qa2'],['PORTABILITY_DATABASE_URL','/learners_portability'],['QA2_DATABASE_URL','/learners_qa2']]) {
  const value = process.env[name]; if (!value) continue;
  let target; try { target = new URL(value); } catch { throw new Error('invalid_isolated_qa_target'); }
  if (!['localhost','127.0.0.1'].includes(target.hostname) || target.pathname !== database) throw new Error('non_isolated_qa_target_denied');
}
RIWI_TARGETS
if test -z "$(git status --porcelain)"; then
  git apply --check "$patch"
  git apply --index "$patch"
else
  # A failed earlier QA may leave this exact candidate staged. Resume only that
  # state; never reset, replace, unstage or discard an unexpected file.
  test -z "$(git diff --name-only)"
  test -z "$(git ls-files --others --exclude-standard)"
fi
python3 - "$manifest" <<'RIWI_BLOBS'
import hashlib,json,pathlib,subprocess,sys
expected=json.load(open(sys.argv[1]))
paths=set(subprocess.check_output(['git','diff','--cached','--name-only'],text=True).splitlines())
if paths != set(expected): raise SystemExit('Unexpected staged paths; preserved and stopped')
for path,sha in expected.items():
    if subprocess.check_output(['git','rev-parse',':'+path],text=True).strip()!=sha: raise SystemExit('Staged blob mismatch: '+path)
    data=pathlib.Path(path).read_bytes()
    if hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()!=sha: raise SystemExit('Working blob mismatch: '+path)
print('Verified reviewed blobs:',len(expected))
RIWI_BLOBS
candidate_tree=$(git write-tree)
qa_logs=$(mktemp -d /tmp/riwi-batch15-native-qa-XXXXXX)
printf 'Native QA logs: %s\n' "$qa_logs"
run_gate() {
  local name="$1"
  shift
  "$@" 2>&1 | tee "$qa_logs/$name.log"
}
for round in 1 2; do
  test "$(git write-tree)" = "$candidate_tree"
  run_gate "backend-$round" node --max-old-space-size=2048 --conditions=react-server --import tsx --test --test-reporter=tap --test-concurrency=1 tests/*.test.ts
  run_gate "ui-$round" npm run test:ui
  run_gate "typecheck-$round" npm run typecheck
  run_gate "lint-$round" npm run lint
  test "$(git write-tree)" = "$candidate_tree"
  test -z "$(git diff --name-only)"
done
git diff --cached --check
test -z "$(git ls-files --others --exclude-standard)"
test -z "$(git diff --name-only)"
test "$(git write-tree)" = "$candidate_tree"
test "$(git ls-remote origin "refs/heads/$branch" | awk '{print $1}')" = "$expected_base"
printf 'Verified candidate tree: %s\n' "$candidate_tree" > "$qa_logs/state.txt"
printf '%s\n' 'Two native non-build QA rounds passed; skipped external fixtures remain open. Build was not rerun under owner instruction.'
git commit -m "fix(riwi): verify owner policy rollback and reconcile remaining-work evidence"
git push --porcelain --no-force origin "HEAD:$branch"
published_commit=$(git rev-parse HEAD)
test "$(git ls-remote origin "refs/heads/$branch" | awk '{print $1}')" = "$published_commit"
printf 'Published commit: %s\nNative QA logs: %s\n' "$published_commit" "$qa_logs"
printf '%s\n' 'Independent GitHub tree/blob verification is still required before adding six groups to accepted progress.'
