# Practice with AI — Final Implementation Report (§85)

**Status: implementation complete and committed; browser and live-provider verification remain owner-side.**
Every claim below was produced by running the command shown. Nothing is marked PASS that was not executed.

---

## A. Session branch

`arena/01a10add-learners-area` — isolated from every other workstream. No fetch, merge,
cherry-pick or rebase touched `main`, `arena/01a10332-learners-area`,
`arena/speaking-practice-ai`, `arena/speaking-practice-ai-v2` or any other branch.

## B. Starting SHA

`46d1d162757c004f7122db5276e1ff4d650762c9`
(verified base `arena/speaking-practice-ai-v2`; the session was re-pointed here with the
user's explicit one-time approval and a SHA guard. `git merge-base --is-ancestor` confirms
HEAD descends from it.)

## C. Final SHA

**Implementation SHA (all source, schema, migration and tests):**

```
60dc060915381226ecf73beebeb418c83c5d0303
```

This document is committed directly on top of it as one or more docs-only commits, so the
branch tip is later than the implementation SHA above. The only file that differs between the
implementation SHA and the tip is this report (plus typo-level corrections to it); no source,
schema, migration or test file changes after `60dc060`. The tip SHA is reported alongside this
document rather than inside it, so it cannot go stale.

Seven commits on top of the base:

```
60dc060 test(speaking-ai): session layer against real PostgreSQL; injectable connection
c210a43 test(speaking-ai): rendered-flow matrix for the Practice with AI UI
75d3d45 feat(speaking-ai): the Practice with AI learner flow
24f1d73 feat(speaking-ai): session API surface (start, resume, answer, skip, finish)
b9727e6 feat(speaking-ai): deterministic session summary + provenance-safe projection
1091438 feat(speaking-ai): capture engines, browser_stt provenance, session persistence
ade1100 feat(speaking-ai): stable randomized session plan + schema for AI sessions
```

## D. Changed-file list — 43 files (27 added, 16 modified), 0 deleted

(Not counting this report, which is a docs-only commit on top.)

**Added — plan, capture, provenance, validation, summary (14)**

| File | Purpose |
| --- | --- |
| `src/lib/speaking/ai-session-plan.ts` | Seeded randomised examiner plan; contiguous 3–6 question topic clusters |
| `src/lib/speaking/ai-session-summary.ts` | Pure deterministic aggregation over stored rows |
| `src/lib/speaking/browser-transcript.ts` | Resolves the reviewed browser transcript; derives `edited` server-side |
| `src/lib/audio/microphone-check.ts` | Device check measuring real RMS; releases the mic on every path |
| `src/lib/audio/browser-stt.ts` | Browser SpeechRecognition controller (interim/final, bounded restart, abort/release) |
| `src/lib/data/speaking-ai-sessions.ts` | Session persistence: immutable plan, bounded cursor, re-authorised binding |
| `src/lib/services/coach/public-evaluation.ts` | The one learner-safe projection of an evaluation |
| `src/lib/validation/speaking-ai.ts` | Strict session schemas |
| `src/components/speaking/ai/useBrowserTranscript.ts` | React binding; capability probed after mount |
| `src/components/speaking/ai/MicrophoneCheckPanel.tsx` | Mic gate UI |
| `src/components/speaking/ai/AiAnswerComposer.tsx` | record → live transcript → STOP → review → Send to RIWI |
| `src/components/speaking/ai/AiAnswerFeedback.tsx` | "Checked by RIWI" evidence card |
| `src/components/speaking/ai/AiPracticeSession.tsx` | Journey orchestration |
| `src/components/speaking/ai/AiSessionSummaryCard.tsx` | Summary with stated suppression reasons |

**Added — API routes (5)**

`src/app/api/speaking/ai/sessions/route.ts`,
`.../sessions/[id]/route.ts`,
`.../sessions/[id]/complete/route.ts`,
`.../sessions/[id]/items/[itemId]/complete/route.ts`,
`.../sessions/[id]/items/[itemId]/skip/route.ts`

**Added — tests (6)**

`tests/speaking-ai-session-plan.test.ts`, `tests/speaking-ai-capture.test.ts`,
`tests/speaking-ai-summary.test.ts`, `tests/speaking-ai-provenance.test.ts`,
`tests/speaking-ai-sessions-db.test.ts`, `tests/ui/speaking-ai-ui.test.tsx`

**Added — migration (2)** — see §F.

**Modified (16)**

| File | Change |
| --- | --- |
| `src/db/schema.ts` | Session tables; `transcript_raw/edited/edited_at`, `retry_of_attempt_id`; `transcript_origin` widened |
| `drizzle/meta/_journal.json` | Entry 45 |
| `src/app/(app)/speaking/ai/page.tsx` | Resume-never-rebuild; no longer gates on STT |
| `src/app/api/speaking/attempts/route.ts` | Verified `retryOfAttemptId` lineage |
| `src/app/api/speaking/attempts/[id]/submit/route.ts` | Browser transcript, provenance storage, learner-safe response |
| `src/components/speaking/AiExaminerSession.tsx` | Entry shell; readiness is informational, not a gate |
| `src/lib/data/evaluations.ts` | Optional injectable connection (2 functions) |
| `src/lib/i18n/en.ts`, `src/lib/i18n/uz.ts` | Full EN + UZ copy for every new string |
| `src/lib/services/coach/types.ts` | Canonical `TranscriptOrigin` incl. `browser_stt`; `transcriptEdited` |
| `src/lib/services/coach/service.ts` | Re-export the canonical union (no second copy) |
| `src/lib/services/coach/speaking.ts` | Threads `transcriptEdited` |
| `src/lib/services/coach/providers/riwi/speaking.ts` | Honest confidence for `browser_stt`/edited; rate note says "counted from your edited transcript" |
| `src/lib/services/riwi/outbound-guard.ts` | Accepts the new origin + `transcriptEdited` (`.strict()` would otherwise reject them) |
| `src/lib/services/riwi/evaluation-tools.ts` | Accepts `browser_stt`; labels it "browser-recognised", never "transcribed" |
| `src/lib/validation/speaking-practice.ts` | Browser transcript pair + `retryOfAttemptId` |

## E. Per-behavior verification

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| §8 microphone check | `microphone-check.ts` + `MicrophoneCheckPanel` | 4 UI tests + 13 engine tests: denied/unsupported/pass, no_input truthful, tracks+context released on every path, **no network call during the check** |
| §13–18 browser transcript, review, no auto-send | `browser-stt.ts`, composer, submit route | **UI test "STOP does not send anything"**: the only call in the whole record→stop cycle is `/api/live-partner`; no `/submit`, no `/api/uploads`, no binding. Clear and Re-record likewise upload nothing |
| §14 edited provenance | server-derived comparison | 9 provenance tests incl. punctuation fixes = edited, whitespace-only ≠ edited, empty ⇒ falls through to real STT |
| §9/§10 topic clusters 3–6 | `ai-session-plan.ts` | 27 plan tests; DB test asserts clusters are contiguous |
| §11 plan stable on refresh | rows written once; `planFromPersistedItems` takes no RNG | DB tests: repeated reads identical; resume issues **zero** requests (UI test) |
| §28 no band from Part 1 | `ai-session-summary.ts` | Suppression keys off parts **answered**, so a "full" session with only Part 1 answered is withheld too. 6 summary tests + 2 UI tests + 2 DB tests |
| §29 deterministic aggregation, no invented numbers | pure function over persisted rows | 24 summary tests incl. an identical-input deep-equal test |
| §23/§34 pronunciation never faked | `notAssessedPronunciationCriterion` | Stays band-less and excluded from means through a **database round trip**; UI renders "Not assessed" with no digits in the row |
| §30 Try again = new attempt | `retry_of_attempt_id` | DB tests: original attempt keeps its own transcript/status; unrelated attempt **cannot** overwrite; a retry of a different attempt is refused |
| §43 no trust in client authority | `.strict()` schemas + server re-authorisation | 25 provenance tests reject `userId`/`role`/`seed`/`plan`/`transcriptOrigin`/`provider`/`score`/`band`; DB tests cover foreign attempt (403), prompt mismatch, unsubmitted attempt |
| §46/§81 idempotency | reuse paths + max() cursor | DB tests: replay reports reuse and does not double-advance; a stale bind cannot rewind the cursor; completing twice is a no-op |
| §20–22 attribution | `PUBLIC_CHECKED_BY`, explicit projection | Sentinel-value scans assert no provider/model/version string survives; feedback UI has no field capable of carrying one |
| §33 recent-history avoidance | de-prioritise, never exclude | Planner falls back to the whole pool; history is strictly per-user (DB test) |
| §68 Practice on Your Own + §34 mic exclusivity | untouched; `practice_started` preserved | Composer calls `/api/live-partner` before acquiring the mic and refuses on 409. `QuestionRecorder` and its tests unchanged; UI suite green |
| §71 EN + UZ | `uz.ts` is typed `Dictionary` | A missing key is a compile error; `speaking-hub-rebuild` S10 asserts parity and no Cyrillic |

## F. Schema / migration changes

`drizzle/0045_speaking_ai_sessions.sql` + `drizzle/meta/0045_snapshot.json`, journal entry 45.

**16 statements, all additive.** Verified: no `DROP`/`DELETE`/`TRUNCATE` (FK
`ON DELETE` clauses excluded from the scan), every statement begins with
`CREATE`/`ALTER … ADD`/`SET DATA TYPE`.

- `speaking_ai_sessions` — mode, status, plan version, seed, cursor, limitations, timestamps
- `speaking_ai_session_items` — ordinal, prompt FK (`set null`), part, topic, positions, cluster size, cue flag, attempt FK (`set null`), status; **unique(session_id, ordinal)**
- `speaking_attempts` — `+transcript_raw`, `+transcript_edited`, `+transcript_edited_at`, `+retry_of_attempt_id` (self-FK `set null`) `+index`, and `transcript_origin` widened `varchar(10)→(20)`

## G. Focused test results

| Suite | Result |
| --- | --- |
| `tests/speaking-ai-session-plan.test.ts` | **27 / 27 pass**, 0 fail, 0 skip |
| `tests/speaking-ai-capture.test.ts` | **31 / 31 pass**, 0 fail, 0 skip |
| `tests/speaking-ai-summary.test.ts` | **24 / 24 pass**, 0 fail, 0 skip |
| `tests/speaking-ai-provenance.test.ts` | **25 / 25 pass**, 0 fail, 0 skip |
| `tests/speaking-ai-sessions-db.test.ts` | **32 / 32 pass**, 0 fail, 0 skip |
| `tests/ui/speaking-ai-ui.test.tsx` | **26 / 26 pass**, 0 fail, 0 skip |

**165 new tests, all passing.**

## H. Broader results

```
npm run typecheck  → exit 0
npm run lint       → exit 0  (eslint --max-warnings=0)
npm test           → exit 0  tests 1316 · pass 1226 · fail 0 · skipped 90
npm run test:ui    → exit 0  tests 255  · pass 255  · fail 0 · skipped 0
npm run build      → exit 0  (all 5 new API routes + /speaking/ai compiled)
```

Re-run in full at the frozen implementation SHA on **2026-10-05** (Asia/Tashkent):
all five gates above reproduced these exact numbers, and the five backend §G suites reproduced
`139/139 pass · 0 fail` (27+31+24+25+32). `npm run qa:pg` reproduced `migrations ok: 46 / 46`,
`fixtures ok: owner, student`, with the local database stopped again afterwards.

Baseline before any edit, same environment: `1177 tests · 1087 pass · 0 fail · 90 skipped`.

Delta: **+139 backend tests, +139 passing, skips unchanged at 90, zero regressions.**
(The UI comparator is the suite total, 255, which includes the 26 new UI tests.)

One guard violation was found and fixed rather than suppressed:
`MicrophoneCheckPanel` pushed the raw status literal `"requesting_permission"` into rendered
state, which `tests/ui-error-copy-guard` EG1 forbids. The line was redundant — the check
engine already emits that transition — so it was removed, leaving one owner of the status
vocabulary.

## I. Skipped / blocked / unverified

| Item | Status | Reason |
| --- | --- | --- |
| Authenticated browser walkthrough of the full flow | **UNVERIFIED** | No browser session is available in this sandbox; see §K |
| Real `SpeechRecognition` in Chrome/Safari | **UNVERIFIED** | Browser feature; the controller is unit-tested against a faithful fake, including the Chrome silence-restart path |
| Live external AI provider producing a real evaluation | **NOT EXERCISED** | No credentials configured; making paid calls was not permitted. See §J |
| Server STT fallback path | **NOT EXERCISED** | Requires a configured provider |
| Applying 0045 to Preview/Production | **OWNER REQUIRED** | Explicit approval needed; see §L |
| Mobile/desktop visual review | **UNVERIFIED** | Not testable here; the layout reuses existing responsive primitives |

The 90 skipped tests are the pre-existing baseline set, unchanged by this work.

## J. Live-provider verification status

**Not verified, and no claim is made that it works.** Two evaluation modes were built and
are distinguishable, and both are honestly labelled:

- **If an external evaluator is configured**, it reasons and the learner still sees only
  "Checked by RIWI", while `providerId`/`model`/versions/`fallbackFrom` are stored on the
  row for owner audit.
- **With nothing configured** (the state in this sandbox) the existing deterministic
  evaluator runs and the UI says so in plain language: *"Checked by RIWI's built-in checks…
  it is not an official IELTS band, and it will not claim to be one."* Nothing pretends an
  external model ran.

What *was* tested is the boundary, not a vendor: `outbound-guard` (a `.strict()` schema)
accepts `browser_stt` and `transcriptEdited` and rejects anything else, and the projection
tests prove no vendor string can reach a learner payload.

## K. Authenticated-browser verification status

**Not performed.** No browser and no authenticated session are available in this sandbox, so
the following remain owner-side checks: the real permission prompt and its three distinct
outcomes; live interim text appearing while speaking; the Chrome auto-restart after silence;
playback of the local take; the microphone indicator going out on Stop; and the layout at
mobile width. The rendered flow is covered by 26 jsdom tests, which is **not** a substitute.

## L. Owner / external actions required

1. **Approve applying `0045_speaking_ai_sessions.sql`** to Preview and Production. Nothing
   was applied anywhere except a throwaway local database in this sandbox.
2. **Browser QA** of the walkthrough in §K on a real device.
3. **Decide the external evaluator**: if one should be primary, configure the provider and
   confirm the §72 wording ("no separate STT API bill for the browser path" — never "fully
   local", because browser speech recognition may itself send audio to a vendor service).
4. **Review the integration** with the `arena/01a10332-learners-area` workstream — see §O.
5. Optionally approve a PR from this branch; none was opened, and no merge was performed.

## M. Worktree state

Clean. `git status --porcelain` returns no entries. No build output, cache, log, scratch file
or debug file was committed; a scratch file used during test debugging was deleted before its
commit. Ignored paths were checked and contain only expected build/install directories.

## N. Local / remote verification

```
implementation SHA (local = remote) : 60dc060915381226ecf73beebeb418c83c5d0303
branch tip pushed (local = remote)  : this report commit (docs only, no code)
main                                : bcbf3ebdf54039c3807fcf9479dec5b5c306a0ea  ← untouched
origin/main                         : bcbf3ebdf54039c3807fcf9479dec5b5c306a0ea  ← untouched
FETCH_HEAD (v2 base)                : 46d1d162757c004f7122db5276e1ff4d650762c9
```

`git rev-parse HEAD` and `git rev-parse origin/arena/01a10add-learners-area` were compared and
found identical at the implementation SHA before this document was written; the docs commit is
then pushed so they are identical again at the tip.

Only `arena/01a10add-learners-area` was pushed. No force-push, no rebase, no reset after the
approved re-point.

## O. Expected integration conflict with the parallel workstream

Two points, both small and both in shared Coach/RIWI files:

1. **`src/db/schema.ts`** — this branch adds `speaking_ai_sessions`,
   `speaking_ai_session_items` and four `speaking_attempts` columns under migration **0045**.
   A parallel branch adding migrations from 0045 upward will collide on the number. The
   resolution is mechanical: renumber and regenerate the snapshot; the SQL itself is
   add-only and order-independent.
2. **`src/lib/services/coach/providers/riwi/speaking.ts` and
   `src/lib/services/coach/types.ts`** — this branch extends `TranscriptOrigin` with
   `browser_stt` and adds `transcriptEdited`. If the parallel work also edits the speaking
   provider's confidence block, the edits are adjacent but semantically independent.

Not a conflict but worth knowing: `src/lib/speaking/ai-session.ts` (the legacy
`buildExaminerScript`/`AI_MODES`) is deliberately **kept** — it is still covered by
`tests/speaking-hub-rebuild` S7 and `ai-session-plan.ts` documents itself as its successor.
Removing it is a separate cleanup decision.

---

## Known limitations, stated plainly

- **Browser speech recognition is not local.** It is a browser/vendor feature that may send
  audio to a vendor. The only honest billing claim is that Learners Area pays no separate
  STT API cost on this path.
- **The live transcript is user-side and editable**, so it is weaker evidence of spontaneous
  speech than a server transcript. Origin is recorded as `browser_stt` and an edited
  transcript is flagged, discounted slightly in confidence, and disclosed to the learner.
- **A stale plan can outlive a prompt.** If a prompt is deleted after a plan is written, the
  item survives and renders as unavailable rather than being replaced with invented text.
- **The summary is a text-based estimate.** It is never an official IELTS band, and a
  Part-1-only session deliberately has no overall estimate at all.
