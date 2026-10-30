# V39 — Listening Test Hub and Activity routes

Scope: `/app/listening/tests/:id` (Hub) and `/app/listening/tests/:id/:activity` (Activity), native Vanilla JS under `migration/vanilla-frontend/`. Original Next.js sources were read only. Original Listening HTML tests were not modified.

## Verdict

| Route | Status after V39 | Why |
| --- | --- | --- |
| `/app/listening/tests/:id` (Hub) | **IN PROGRESS** (unchanged) | Tested branches pass (78/78 combined matrix). Not promoted: see *Remaining gaps* for the exact unverified obligations. |
| `/app/listening/tests/:id/:activity` (Activity) | **IN PROGRESS** (unchanged) | Two demonstrated gaps fixed (invalid segments, practice prediction reset). Not promoted: lexical assistance, Say-it/`speechSynthesis`, touch/back-forward on the activity screens, and 403 on activity writes are not run. |

Route counts remain **9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff**. No route was promoted in V39. Route promotion is not tied to the unsigned Phase2 decision, and no production access was probed.

## Source-grounded fixes (reproduced first, PASS after)

1. **Invalid activity segments issued a request (route dispatch).**
   - Reproduction: run 6 (`/tmp/v39-run6.log`, preserved as `docs/evidence/v39/reproduction-prefix-run6.txt`) — `FAIL V39 activity invalid route segments are not-found and issue no request (activity 0, 6, malformed id)`, `locator.waitFor: Timeout 8000ms exceeded`.
   - Source: `src/app/app/(focus)/listening/tests/[id]/[activity]/page.tsx` (numeric segment rule; activities 1–5 are the only valid numeric segments).
   - Fix: `modules/listening/route-v7.js` — `invalidActivitySegment(activity, attempt)` rejects before any request (activity `0`, `6`, malformed id, and non-numeric segments that are not practice/`mcq`/`study`), and dispatch is numeric. Activity `02` maps to activity 2 (original `Number(segment)` rule). Backup of the pre-edit file was kept at `/tmp/route-v7.before.js` (not in repo).
   - PASS after: runs 7–14.

2. **Practice Previous/Next did not reset the prediction field.**
   - Reproduction: run 6 — `FAIL V39 practice Previous and Next move between questions and reset the prediction field — prediction reset on Next`.
   - Source: `src/components/listening/ListeningPractice.tsx` line 32 — Previous/Next call `setIndex(...)` and `setPrediction("")`.
   - Fix: `modules/listening/practice.js` — `setIndex`/`setPrediction` now clear the prediction before redraw, matching the original.
   - PASS after: runs 7–14.

Harness corrections made during the session (these correct the V39 test's own assumptions; no product assertion was weakened). The earlier failing logs are preserved in `docs/evidence/v39/harness-iterations/`:
- Activity fixtures needed a non-null `total` and the authored fixture needed the correct kind (run 3 → run 5).
- `waitForFunction` replaced by a CSP-compatible readiness check; `getByText` made case-insensitive where the source casing varies.
- **Inner "← Test hub" link (run 13 → run 14).** The new activity matrix expected the dictionary value `d.fullListeningHub.examStart.back` (`"Test markazi"` in UZ). The original `src/components/listening/FullListeningActivity.tsx` line 237 hard-codes `← Test hub` in every locale, and the native `js/generated/FullListeningActivity-v8.js` matches that literal. The assertion was corrected to the source literal (`exact: true`). This is **source parity, not a defect**: the Activity inner link is untranslated in the original too. Reported here as an observation for the owner.

## Browser matrix (final run 14)

- Command: `node tests/browser-listening-v39.mjs` in `migration/vanilla-frontend/`.
- Result: **78 PASS / 0 FAIL** (`docs/evidence/v39/final-run14-browser-listening-v39.txt`; structured results `docs/evidence/v39/browser-listening-v39-results.json`).
- Earlier: run 13 72/6 (the six UZ inner-link cases, explained above); run 7 56/0; run 12 64/0 before the activity matrix was added.

### Hub (`/app/listening/tests/:id`)

| Workflow | Test (PASS) |
| --- | --- |
| Direct entry | hubDTO renders test meta and card links (EN, desktop) |
| Latest scores | completed and in-progress badges reflect server latest scores |
| Draft vs published | QA draft notice shown only for draft |
| Card navigation, back/forward | card click → activity; Back and Forward restore both screens |
| Reload | direct reload refetches the authorized view and keeps the hub |
| Keyboard | Tab reaches Back link then exam card CTA; Enter follows the link |
| Touch | tap on card CTA navigates (touch emulation, 390 px) |
| Cold-entry Back | Back link follows its library href (no history on the page) |
| 403 sequence_locked | locked section links to academic |
| Locked kind from view | locked section shown |
| 404 | original not-found screen, no hub content |
| Malformed id | no data request; not-found screen |
| 500 + retry | region error; Try again re-requests and renders |
| Network failure | region error, no hub content |
| 429 | region error, no hub content |
| 403 (not locked) | region error, no hub content |
| 401 | session ends: hub content removed, navigates to `/login` (authority logout) |
| Unrecognized kind | region error, no fabricated content |
| Unauthorized data | payload with extra transcript field refused; transcript never renders |
| Authored kind | sandboxed authored frame, `allow-scripts` only |
| Source switch | pushState + popstate replace hub with the new test only |
| Stale response | in-flight request discarded after in-app navigation |
| Matrix (12) | 1440×900, 768×1024, 390×844 × EN/UZ × Day/Night: title, card CTA href, no horizontal overflow |

### Activity (`/app/listening/tests/:id/:activity`)

| Workflow | Test (PASS) |
| --- | --- |
| Invalid segments | activity 0, 6, malformed id → not-found, no request |
| Segment `02` | activity 2 (original numeric rule); `00` not-found, no request |
| Activity 1 | original exam start; Start posts once and navigates to attempt |
| Activity 1 failure | start failure shows original message; Retry resumes same path |
| Activity 3 save | Save progress posts `complete:false` with typed gap answer; answer kept on screen |
| Activity 3 failed save | save-failed message; typed gap answer kept |
| Activity 3 network | network failure on Save → exactly one write (no silent replay) |
| Activity 3 401 | write returning 401 ends session (authority logout to `/login`), no retry |
| Activity 3 reload | typed gap answer restored from local draft (sessionStorage), not from server |
| Activity 2 429 | rate-limited Complete shows save-failed, displays no score |
| Activity 2 complete | Complete posts `complete:true`; server score shown (no client grading) |
| Activity 2 authored | kind `authored` redirects to hub with no fragment |
| Activity 4 | Commit and reveal disabled until a meaning is chosen; Save posts chosen index once; failed Save keeps choice |
| Activity 4 keyboard | Enter on focused Save progress sends one save |
| Activity 5 vocabulary | folder list loads; chosen folder sent with sense and term; panel closes; failed save keeps panel |
| Activity 5 Quiz | Check all answers is the graded Complete write; changed choice clears verdict (original `answer()` → `setResult(null)`); re-check |
| Exam in progress | activity 2 shows exam-locked notice |
| Unknown kind | region error, never fabricated activity |
| Source switch | popstate loads only the new test activity |
| Reload | direct reload refetches and keeps the same activity screen |
| Matrix (12) | activity 3 at 1440×900 / 768×1024 / 390×844 × EN/UZ × Day/Night: own labels, single save button, inner Test hub link (literal), no horizontal overflow |

### Practice (`ListeningPractice`, activities routed through the practice segment)

| Workflow | Test (PASS) |
| --- | --- |
| Matching | Check disabled until answered; Check posts answered questions only; verdict and key shown |
| Finish | blocked until every question answered; then `complete:true` for all |
| Previous/Next | move between questions; prediction reset (fixed) |
| Completion | text answer sent as typed; Test hub link returns to hub |
| Retry, nothing missed | original empty message |
| Map | plan renders; location answer submitted (`ListeningMap`) |
| 500 | common error; Try again succeeds |
| Exam in progress | exam-locked notice |
| Answer-key refusal | payload with `key` in a question refused: region failure, no question control |
| Media lifecycle | in-app navigation away pauses audio and detaches source |

## Applicability matrix (required coverage categories)

Status key: **PASS** = executed browser case(s) above; **NOT RUN** = applicable, not yet executed (a gap, blocks promotion); **N/A** = not applicable to this route, with reason.

| Category | Hub | Activity |
| --- | --- | --- |
| Direct entry | PASS | PASS (activities 1, 2, 3, 4, 5; practice) |
| Reload | PASS | PASS (activity 3 draft restore; activity direct reload) |
| Back/forward | PASS (card click, Back/Forward) | NOT RUN on activity screens (only hub Back/Forward tested) |
| Keyboard | PASS (Tab order, Enter) | PASS (activity 4 Save via Enter); other activity keyboard flows NOT RUN |
| Touch | PASS (390 px tap) | NOT RUN on activity screens |
| EN/UZ | PASS (matrix) | PASS (activity 3 matrix); practice EN only, UZ NOT RUN |
| Day/Night | PASS (matrix) | PASS (activity 3 matrix) |
| Desktop/tablet/mobile | PASS (1440, 768, 390) | PASS (activity 3 matrix); other activities at these widths NOT RUN |
| Session expiry | PASS (401 → `/login`) | PASS (activity 3 write 401 → `/login`) |
| 401 | PASS | PASS (activity 3 write) |
| 403 | PASS (not-locked region error; locked section) | NOT RUN on activity writes/start |
| 404 | PASS (not-found screen; malformed id) | PASS (invalid segments, no request) |
| 429 | PASS | PASS (activity 2 Complete) |
| 500 | PASS (with retry) | PASS (activity 1 start, practice with retry) |
| Network | PASS | PASS (activity 3 Save: one write, no replay) |
| Error/retry | PASS (hub 500 retry) | PASS (activity 1 start retry; practice retry) |
| Source navigation | PASS (card, popstate, stale response) | PASS (popstate; Test hub link from practice) |
| Media lifecycle | N/A for hub's own UI (no hub-owned media); authored frame's own media is owned by the authored runtime and NOT RUN here | PASS for practice (pause and detach on navigation); activity 2/3/4 clip playback NOT RUN |
| Source replacement | PASS | PASS |
| Unauthorized-data refusal | PASS (transcript field refused; unknown kind) | PASS (practice answer key refused; unknown kind) |
| Lexical assistance (word lookup/popover) | N/A on hub (no lexical surface) | NOT RUN — the original imports `lexicalAssistanceAllowed`/`modeForActivity`; not exercised in V39 |
| Say-it (`speechSynthesis`) | N/A on hub | NOT RUN — activity 5 Study/Say-it not covered |
| Authored/original-runtime redirect | PASS (authored sandbox frame) | PASS (activity 2 authored → hub, no fragment) |

## Remaining gaps (exact)

These are the obligations that keep both routes IN PROGRESS. Each must be implemented or demonstrated correct before promotion.

1. **Activity lexical assistance** — `src/app/app/(focus)/listening/tests/[id]/[activity]/page.tsx` computes `lexicalAssistanceAllowed` / `modeForActivity` (`src/lib/listening/lexical-policy.ts`) and passes spans. Native activity lexical popovers/word lookup are not tested in V39.
2. **Activity 5 Study / Say-it** — `speechSynthesis` path is not covered. No executed case.
3. **Activity-screen touch, back/forward, UZ practice, and 403 on activity writes/start** — not run.
4. **Activity 2–4 media lifecycle** — clip playback and pause/detach on navigation for the activity screens are not run (practice only).
5. **Hub authored-frame media** — the authored sandboxed frame's own media is not separately verified.
6. **Visual strict pixel parity** — 768 UZ day hub remains a strict FAIL (see Visual). Acceptance tolerance not changed.
7. **Activity 2 first-attempt control** — the generated render (`js/generated/FullListeningActivity-v8.js`) shows no typed control on a first attempt. Parity with the original was not re-verified in V39; recorded as an observation to check, not a defect.

Production access (live integration, Phase2 release, hardware Safari with real audio) is reported separately and is not a frontend defect.

## Visual investigation — hub 768 UZ day

- Failure: `hub-768-uz-day` (V37 `listening-visual-document.json`): geometry equal, dimensions equal, 2 differing pixels, max channel delta 1. Tolerance unchanged; no palette change.
- The six V37 strict FAILs are all max channel delta 1 with geometry equal: `revision-1440-en-day` (4 px), `revision-1440-en-night` (26 px), `revision-1440-uz-day` (3 px), `revision-1440-uz-night` (20 px), `revision-768-en-night` (1 px), `hub-768-uz-day` (2 px).
- Diagnostic: `tests/browser-listening-visual-v39-diagnostic.mjs`, output `docs/evidence/v39/hub-diagnostic.json` (re-run this session; log `docs/evidence/v39/hub-768-diagnostic-run.txt`). The same run also covers `hub-768-en-day` (1 differing pixel, max delta 1). Results for `hub-768-uz-day`:
  - A (native twice, same page): 0 differing pixels.
  - B (reference twice): 0 differing pixels.
  - C (native vs reference, fresh pages): 2 differing pixels, max delta 1 (samples at x=325,y=462 and x=345,y=465).
  - D (native vs reference, V37 capture order): 2 differing pixels, max delta 1, same samples as C.
  - E (structure, 18 native and 18 reference nodes): no diffs.
  - Settle trials (8 repeated captures): 4 non-zero, counts `[0,2,0,2,2,2,0,0]` — the residual changes between captures, so capture timing is a real variable.
- Screenshots: `docs/evidence/v39/hub-768-{en,uz}-day-C-{native,reference}.png`.
- Conclusion: the residual is sub-threshold, reproducible on the same pair, and tied to capture timing and font rasterisation within Chromium; it is not a layout or style defect (geometry 18/18). Not proven to be a source-style defect. A fresh-vs-fresh reference control for this exact viewport was not measured, so the cause is not fully isolated. Reported as **strict FAIL, unresolved**, with no tolerance change. The `hub-768-en-day` case shows the same pattern at 1 pixel.
- Icons: not separately isolated in V39; all compared geometry nodes matched.

## Regression evidence

Reruns were executed in a scratch copy of the current tree (`/home/user/v39-regress/`) and, for the one comparison, a scratch copy of the V38 HEAD modules (`/home/user/v39-head/`). Repo historical evidence was not rewritten. Logs are in `docs/evidence/v39/regression/` and `docs/evidence/v39/regression/full/`.

Suite-level results (current code):

| Suite | V39 rerun | Historical baseline (repo) |
| --- | --- | --- |
| browser-v7 | 26 PASS / 0 FAIL | — |
| browser-v8 | 79 PASS / 0 FAIL | 79 PASS / 0 FAIL |
| browser-v9 | 29 PASS / 0 FAIL | 29 PASS / 0 FAIL |
| browser-v10 | 53 PASS / 0 FAIL | 53 PASS / 0 FAIL |
| browser (`tests/browser.mjs`) | 27 PASS / 0 FAIL | V38 chain |
| browser-v2 / v3 / v4 / v5 / v6 / v11 | 14 / 49 / 72 / 52 / 77 / 18, all 0 FAIL | V38 chain |
| timing (`scripts/performance-v33.mjs`) | 14 PASS / 0 FAIL (diagnostic, no performance claim) | V38 14/0 |
| assets (`scripts/assets-css-v33.mjs`) | PASS (25 assets, source CSS exact, `renderedVisualComparison: false`) | V38 PASS |
| browser-listening-v38 | 5 PASS / 0 FAIL | V38 5/0 |
| browser-listening-revision-v37 | 1 PASS / 0 FAIL (source identity check only; not the full revision visual suite) | — |
| equivalent controls (`V22_SOURCE=1 V22_BENCH=1`, two `V22 controlled equivalent hash navigation` cases in a 33/0 V22 run) | 33 PASS / 0 FAIL | V38 2/0 |
| actual-source chain (`ORIGINAL_SOURCE_ROOT=/home/user/learners_area npm run test:original-source:v27`) | rerun **418 PASS / 0 FAIL, exit 0** (first run 417/1, see below) | V38 418/0 |

Actual-source chain, full history of this session:

- A first attempt without `ORIGINAL_SOURCE_ROOT` exited on the suite's configuration guard (no test ran; not a result; its log was overwritten). `docs/evidence/v39/regression/full/actual-source-full.txt` is the next run, which set `ORIGINAL_SOURCE_ROOT` but no variant flags: it runs only the default variant (5 PASS / 0 FAIL).
- Run 1 on the current code: 417 PASS / 1 FAIL — `V15 repeated SPA Back/Forward and rapid mounts leave no owned audio or browser mutex`, `locator.waitFor: Timeout 8000ms exceeded` on the original iframe's `#hub:not([aria-busy]):visible,.activity.active:visible`.
- The same journey alone on the current code (`V15_SOURCE=1`): 40 PASS / 0 FAIL.
- Run 2 on the current code (full chain): 418 PASS / 0 FAIL, exit 0.
- Run on the V38 HEAD modules (`route-v7.js` and `practice.js` from `6208ce8`, otherwise identical): 418 PASS / 0 FAIL, exit 0.

Classification: an intermittent, timing-sensitive 8-second locator timeout under full-chain load. It did not reproduce in the rerun or in isolation. Its root cause was **not isolated**, and it is not claimed fixed. The journey does not reach an activity route segment (it uses the SPA `/app/listening` route and the original iframe runtime), so the V39 guard is not expected to affect it, but this is an inference, not a proof. If it recurs, compare its trace against HEAD before changing anything.

## Source checks

- `npm run check:assets` — PASS (25 assets; source CSS exact; V9 immutable pins).
- `npm test` — 605 PASS / 0 FAIL on the final tree (`docs/evidence/v39/unit-npm-test-final.txt`).
- Harness-iteration logs for the V39 browser matrix (failing earlier runs kept for audit): `docs/evidence/v39/harness-iterations/`.

## Next targets (not started in V39)

- **Attempt detail, `/app/listening/attempts/:id`** — IN PROGRESS. Ledger note: the whole attempt/source provider and authored media gate are still partial. Next: audit the source provider and authored media gate against `src/app/app/(focus)/listening/attempts/[id]/page.tsx` and the native attempt module; then add browser matrix cases for those branches.
- **Revision, `/app/listening/attempts/:id/revision`** — IN PROGRESS. Ledger note: broader source/provider/media permission and all-caller gate remain partial. Strict visual FAILs at 1440 EN/UZ day/night and 768 EN night are not investigated (the V37 evidence above). Next: investigate these FAILs with the same method as hub 768 UZ day, then close the provider/permission gap.
- **MCQ library, `/app/listening/mcq`** — IN PROGRESS. Ledger note: fixture subset passes; full source-state and live acceptance are blocked on live data/policy (proposed DTOs or existing APIs disconnected). Ordinary client gaps remain. Next: list the source states of `src/app/app/(shell)/listening/mcq/page.tsx` and cover each in browser cases; live data remains external.
- **MCQ Day, `/app/listening/mcq/day/:day`** — IN PROGRESS. Ledger note: reasoned completion uses `history.replaceState` (same-path guarded) plus `context.refresh()`, matching the original `router.replace` + `router.refresh`. The V38 focus case records focusin targets. Next: the same source-state audit as the MCQ library against `src/app/app/(shell)/listening/mcq/day/[day]/`, and a case for the day-completion refresh path.

Do not start Reading or other modules until Listening implementation is complete and verified (owner directive).

## Owner decisions and external items (reported separately)

- Phase2 A–J release decision: unsigned; not required for frontend route promotion; not approved by this work.
- Production access, live integration, hardware-Safari real-audio: not verified; external.
- Listening Tests 10 and 25 authoritative data issues (40 invalid mappings; Q30 1236 > 1235.879; Q40 1525 > 1524.01): unchanged, not clamped, not regenerated.
- Tests 11/22 storage-key discrepancies: unchanged; source authority required.
- The untranslated inner "← Test hub" literal in the original Activity screen: source-parity observation for the owner.

## Preserved and not changed

- V37 SpeedTrainer attempt-ID fix and V38 legacy submit mapping and MCQ Day focus fix: preserved.
- Original Next.js sources, original Listening HTML tests (32 files), and historical evidence/ZIP archives: unmodified.
- Grammar, Reading, Writing, Speaking, Staff, Dictionary: untouched.
- Sandbox: `allow-scripts` only; no CSP weakening; no same-origin.
