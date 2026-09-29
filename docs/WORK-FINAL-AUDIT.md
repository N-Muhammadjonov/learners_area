# Work Final QA 2 — closure evidence

Closure date: 2026-09-29. Scope: the owner's **CONTINUE_FINAL_QA2_CLOSURE_ONLY** request. This closes the existing hardening work; it does not certify a new production deployment, exhaustive original redesign scope, or the future Dictionary.

## Recovery and decision

**Local QA: PASS.** No unresolved reproduced P0/P1 in the closure scope. Native pointer acceptance and production measurements are explicitly tooling/external limitations, permitted by the owner's closure criteria. They are not converted into product PASS.

- Base: `arena/01a0cf7b-learners-area` @ `ad21acc29491ec64a7254d24f6cfdfa1dc25cb5f`.
- Work branch: `work/final-qa2-hardening`; starting verified remote `e75b46e799fc00298a3e5f2128a10610d0c125df`.
- Recovered local HEAD `f86457da2fad10ebe4951cada480794d7ec9ef5e` plus 23 modified and 9 new files. No reset, restore, clean, stash, branch switch or patch reapplication.
- Existing unpushed shared-text commit retained. Contextual lookup, migration, normalization and tests preserved and reviewed. Final published SHA is reported by the handoff/release message after independent remote verification; this document cannot contain its own commit hash.
- Production DB migration: **NOT APPLIED**. Main: **NOT MERGED**. Production deployment: **NOT PERFORMED**. No Telegram branch changes.
- Earlier observations, failed-then-fixed checks and incremental totals are retained in [checkpoint history](WORK-QA2-CHECKPOINT-HISTORY.md); they are not current results.

## Final automated evidence

All results below come from the final runtime/source state, not the Arena baseline. Closure-only continuation makes documentation edits, and reruns typecheck/lint/build/diff checks.

| Gate | Actual result |
|---|---|
| Full Node suite with `QA2_DATABASE_TESTS=1`, local `.env` | **300 tests, 300 pass, 0 fail, 0 skip** |
| Ordinary `npm test` without DB opt-in | **300 tests, 281 pass, 19 skipped, 0 fail** |
| Real PostgreSQL cases | **19/19**, included in 300, not an additional 19 |
| React DOM shared-text/popup cases | **15/15 nested cases** inside one suite wrapper; do not add to 300 |
| Vocabulary / SRS / games HTTP | **103/103** |
| Contextual lookup/save HTTP + DB | **16/16** |
| Meaningful activity HTTP + DB | **13/13** |
| Retention HTTP | **10/10** |
| Grammar privacy HTTP + DB | **21/21** |
| Auth/admission/role HTTP | **33/33** |
| Support HTTP | **26/26** |
| Typecheck / ESLint / production build / diff whitespace | PASS |

Local raw evidence is outside Git: `work/qa2-final-regression.log`, `qa2-final-npm-test.log`, `qa2-final-{vocabulary,activity,retention-http,grammar,access,support}.log`, `qa2-lexical-migration.log`, `qa2-closure-{typecheck,lint,build}.log`. Context HTTP output was captured in the tool transcript. No credentials, private conversation bundles, local DB files or screenshots are committed.

The old Vocabulary script assumed the first spelling had one authoritative sense. With two `bank` senses the app correctly returned `needs_definition`, so that assertion initially failed. The fixture selection now explicitly requires exactly one eligible catalogue sense; the separate contextual DB test asserts ambiguous `bank` returns no arbitrary sense. No product guard was weakened.

## Correctness and lifecycle

- Shared text uses native inline spans, unchanged separators, one keyboard entry per region and no per-word button/tab semantics. Arrow/Home/End/Enter lookup, Escape restoration, async cancellation, word-state reset and folder saves are covered. Single pointer clicks wait 240ms to allow native double-click selection; drag, noncollapsed selection, long hold, cancellation and context-menu gestures are suppressed without `preventDefault`.
- Reading occurrence offsets identify the exact canonical sense. The server rechecks source access on both lookup and save; submitted fake definitions/IDs cannot replace the resolved sense. Real `bank` tests preserve river-edge ID and reject foreign draft/attempt context without leaking metadata.
- Canonical rows remain shared; personal folders, SRS and short immutable encounter snapshots remain learner-owned. Deleting the source preserves saved words/context. In-use canonical deletion is blocked by FK `RESTRICT`. Games do not advance SRS.
- Atomic shared writer serializes saves per learner; concurrent requests produce one personal entry/award, invalid folder writes nothing, and a failed batch rolls back all writes.
- `normalizeMeaning` retains parenthetical/semicolon distinctions and full definitions. New keys hash the full normalized term/POS/meaning. Existing IDs/keys remain unchanged and are reused only after full semantic equality. Reading imports retain historical keys and stop on conflicting identities rather than silently attaching another meaning.
- Custom canonical inserts are `user_provided/unverified`, excluded from automatic shared catalogue enrichment. Legacy unknown provenance is not labelled editorially verified. See [lexical architecture](LEXICAL-ARCHITECTURE.md).
- Retention regression covers stale summaries, actual learning timestamps, six full calendar months, recent submissions, 18-month history, storage retry and transaction locks. Six DB retention cases include a real cleanup/attachment interleaving and four competing Speaking attachments with one winner. Fresh recordings on old drafts survive. See [retention audit](RETENTION-AUDIT.md) for boundaries; this is not cloud R2 acceptance.
- Grammar source ownership survives source deletion; other learners cannot access private derived exercises. Auth authority comes from current DB role/status; pending/suspended/staff boundaries remain intact. Reset token is never returned to the client. Google/email verification is not implemented and was not added under the conditional regression scope.
- Notification acknowledgements are owned, selective and idempotent. Reading search/clear preserves results/order and correct question counts. Existing transport deadline/cancellation, search authorization and Telegram validation regressions remain green. Support reaches the staff inbox and resolution/audit path in HTTP tests.

## Real browser evidence and limits

Production-mode local preview, seeded QA student; synthetic content only in local `learners_qa2`.

- Reading, Vocabulary, Listening transcript and synthetic video/material page: requested widths **320, 360, 375, 390, 393, 768, 1024, 1440** exercised. Document width equalled viewport width on these representative surfaces. This is not a claim that every route or every physical mobile device was tested.
- Reading popup was inside viewport across all eight widths; at 320px x=8..312. Keyboard focus reached the visible dialog. Escape closed it and returned to the text region. Home/End lookup, bottom-of-text anchoring and resize repositioning observed.
- Listening transcript lookup and video/material lookup were opened by keyboard. One rapid resize sample captured the Listening dialog between async content expansion and ResizeObserver correction; the next observation was contained. This is not a stable overflow reproduction; rapid first-paint positioning remains P3 polish.
- `decades` and `growing`: Vocabulary reload and selected QA Reading-context folder display both expected EN/UZ meanings and Reading source; earlier DB verification matches the folder. No new save claim is inferred from merely opening the list.
- Previously verified outside-close and scroll anchoring remain covered by the 15 real React DOM cases; they were not re-labelled as new physical-pointer browser observations.
- **POINTER/DRAG NATIVE SELECTION — TOOLING-LIMITED / EXTERNALLY UNVERIFIED.** Desktop and 320px drags (both directions on mobile) produced no reliable native text selection. Desktop double-click selected a newline, not the intended word. Screenshot/DOM coordinate mismatch prevents trustworthy physical click/selection/copy acceptance. Handler tests pass; they do not prove real long-press handles/copy. No actual product selection defect was established by these attempts.
- Video/material fixture proves shared text layout/keyboard behavior only. Its synthetic player ID is intentionally not a valid external video; provider playback, captions and external availability are not certified. No source content/branding was copied.
- No separately implemented profile editor exists in the inspected route set; header account menu is the implemented profile surface. A fresh auth-page width matrix, full screen-reader session and real mobile long press were not performed in this closure.
- Browser observations are exploratory acceptance, not a numbered automated browser suite. Do not invent a browser-test total.

## Performance

Local prior 15-navigation browser samples showed median **338.1 → 43.0ms** after removing blanket route-loading delay; methodology and limits are in [PERFORMANCE-AUDIT.md](PERFORMANCE-AUDIT.md). This is not a current production timing claim.

**PRODUCTION PERFORMANCE — EXTERNALLY/TOOLING UNVERIFIED.** Exact production click-to-content, current deployment SHA and representative remote-network performance were not reliably established for this Work build. Work changes have not been promoted. No newly reproduced production performance defect is being silently dismissed; these closure results certify the local tested release candidate only.

## Remaining classification

| Category | Item and consequence |
|---|---|
| EXTERNALLY UNVERIFIED | Native pointer/copy/long-press; real external video playback; cloud R2 credentials/lifecycle; production latency, migration and deployment smoke test |
| P2, non-blocking | Existing saves without occurrence snapshots remain null; repeated saves do not retroactively enrich them. Old duplicate sense/history reconciliation requires reviewed data evidence, not automatic merging. |
| P2, non-blocking | Historic Grammar rows whose source link vanished before 0019 cannot have their former private owner reconstructed; review legacy production data before promotion. No cross-user leak reproduced in the tested current model. |
| P2, non-blocking — Dictionary architecture | Separate headword/sense entities, non-Reading occurrence ownership, inflections, provenance reconciliation and 60k+ load/index tuning remain future work. Current Reading wrong-sense saves are fixed; no readiness claim for a completed Dictionary. |
| P2, non-blocking | Full object inventory/backup-restore drill, replacement-orphan reconciliation and remaining untested concurrent cleanup interleavings need deployment-specific operations evidence. No reproduced current data loss remains. |
| P3 | Rapid async popup remeasurement polish and wider assistive-technology/manual device coverage |
| OUT OF SCOPE | Speaking V3/Live Partner, future Shadowing changes, premium redesign, Dictionary implementation, RIWI V2, billing, new courses and unrelated refactors |

## Manual promotion steps — later owner approval only

1. Use the final verified Work commit in a separate release checkout; install the lockfile with `npm ci`. Take a restorable PostgreSQL backup and preserve private object storage independently. Do not seed production.
2. Provide the production **direct/session** database URL through a private environment (not chat, Git or CLI arguments). Inspect only: `node scripts/migrate-production.mjs`. Confirm target and recorded journal prefix; stop on partial/divergent history. The current chain has **21 entries, 0000–0020**; do not assume production is at any particular entry.
3. During an approved low-write maintenance window, run `node scripts/migrate-production.mjs --apply` and confirm the target database name interactively. Do not use `--yes`, `db:push`, reset or seed. From a verified 0018 base this applies 0019 and 0020. Successful apply uses documented exit code 2; inspect again afterwards.
4. 0020 replaces the child FK and adds nullable JSONB; it does not rewrite IDs/SRS, delete rows or require a JSON index. It takes PostgreSQL DDL locks and validates the new FK; do not run blindly amid long writes. 0019 backfill/trigger also needs the maintenance window. Existing FK ensures old references are valid. Fresh and populated-0019 upgrade paths passed in disposable QA DBs.
5. Only after migration inspection and explicit promotion approval, deploy the same verified Work SHA. Confirm `/api/version` identifies it, then smoke-test auth/roles, Reading exact sense/folder save, support, Audit reload, themes and real R2 delivery on the deployed environment.
6. Manually retest desktop drag both directions/copy/double-click, mobile long press, click/tap lookup and Escape at 320px. Measure real click-to-meaningful-content over repeated production navigations. These are external acceptance, not results already obtained here.
