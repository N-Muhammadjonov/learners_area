# QA suite triage — 2026-10-09

Scope: §6 of the sixth correction round ("triage all incomplete acceptance suites").
Measured against the worktree at `f9a09ea`, built server, `learners_qa2` reseeded.

## Headline

Four of the suites previously reported as "no output" were **never broken**. They
aborted before their first assertion because the harness invocation was missing
environment the server requires. A suite producing no output is not a pass — but it is
also not necessarily a defect, and these were not.

## Root causes found

| Suite | Previous | Root cause | Now |
|---|---|---|---|
| `verify-reading-v4` | no output | `AUTH_SECRET` unset — script throws at import time | **93/93 PASS** |
| `verify-listening-academic` | no output | same | **50/50 PASS** |
| `verify-listening-general` | no output | same | **46/46 PASS** |
| `verify-retention` | no output | `STORAGE_PROVIDER` unset → `/api/owner/retention` 500s inside its transaction | **10/0 PASS** |
| `verify-uploads` | 18 pass / 26 fail | same `STORAGE_PROVIDER` gap: no object could ever be written to disk | **23 pass / 21 fail** — still open |

Classification per the required taxonomy:

- `reading-v4`, `listening-academic`, `listening-general`, `retention`:
  **environment/invocation issue**, not a production defect. Closed.
- `uploads`: **partially** environment. The storage gap was real and masked every
  disk assertion; 21 assertions remain and need individual classification. Still OPEN.

## Required invocation

The server and the probes must agree on all four variables. The retention and uploads
routes fail closed when storage is unconfigured, which is correct production behaviour —
`src/lib/services/storage/index.ts` deliberately refuses to guess in production.

```
DATABASE_URL=postgres://postgres@localhost:5432/learners_qa2
AUTH_SECRET=qa2-closure-acceptance-secret-0123456789
STORAGE_PROVIDER=local
STORAGE_LOCAL_DIR=/tmp/qa2-uploads
BASE_URL=http://127.0.0.1:3000
```

Note `STORAGE_PROVIDER` must be passed to **both** the server process and the probe:
the probe asserts against the local disk path directly via `LOCAL_UPLOAD_ROOT`.

## Reconciliation of §3 and §4 (raised again, already closed)

Verified against current code rather than re-implemented.

**§3A replay idempotency.** The prompt states the new-trainer insert path does not
populate `run_token_id`. It does: `src/lib/services/writing/typing-runs.ts:131-132`
inserts the column and `:664` passes `runTokenId: jti`. The bounded 50-event scan at
`:601` is reached **only** when `hasRunTokenColumn()` is false, i.e. the pre-0048
compatibility path, and is labelled as explicitly weaker. The modern path is
`findRunByToken` (unbounded, user-scoped) plus the partial unique index.

**§3B instant complete-text submission.** Guarded at `:508-527` —
`MAX_HUMAN_WPM = 250`, `ELAPSED_GRACE_MS = 1500`, floor applied on every submission
shape, plus a hard 3 s floor.

Evidence: `tests/typing-run-integrity.test.ts` + `tests/writing-typing.test.ts` →
**26 pass / 0 fail**.

**§4 vocabulary.** The prompt reports 95 pass / 10 fail. Current measured result is
**101 pass / 0 fail**. The ten failures were triaged and fixed in the previous round
(`286ad20`); the figure in the prompt is stale.

## Still open

- `verify-uploads`: 21 assertions, unclassified.
- `verify-reading`, `verify-shadowing`, `verify-pages`, `verify-owner`,
  `verify-listening`, `verify-coach`: partial failures, unclassified. These were last
  measured **without** the storage env, so some fraction may share the same root cause
  and must be re-measured before being classified as defects.
