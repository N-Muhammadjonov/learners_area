# Phase 3 — IELTS content audit and Vocabulary integrity repairs

Date: 2026-11-09. Overall status: PARTIAL. Scope: audit rows 28–48.

Current instructions: learning materials stay on main. This change contains code, synthetic tests and audit documentation only. Browser interaction, real audio, microphone/device acceptance and continuous stability are reserved for the owner. None was performed in this Phase 3 execution.

## Starting state and Phase 2

- Repository: N-Muhammadjonov/learners_area.
- Arena parent: `5138743533dd4beb09a4e24e806fb47034a41d43`.
- Read-only main: `bc48ac44ebb8dc65df69d3e477a1494845b60938`.
- Comparison: diverged, arena ahead 88 / behind 3. No merge, rebase or cherry-pick.
- The previous local checkout contained uncommitted Phase 2 work. It was left intact. A separate source copy was checked against the remote Git blob manifest. The local materialization commit is bookkeeping, not an upstream ancestor. Publication uses the real remote tree and real parent with an expected-head lease.
- Phase 1 final review and Phase 2 reports through `08-followup-summary.json` were read. Phase 2 remains PARTIAL. Its Reading draft recovery, stale-tab protection and build-input repairs are preserved.
- Phase 2 remaining browser/audio/device/network/performance and manual stability gates now belong to owner QA. Eleven legacy Listening importer cases still require the original owner fixture. No outstanding Phase 2 source repair was proved by those missing manual results.

## Implemented behavior

1. Choice, gap, translation, builder and matching wait for the authoritative server verdict. Transport failure keeps the answer available for retry and does not count it as correct.
2. A pending answer is single-flight. Route exit discards a late verdict. A verified builder answer cannot be cleared and counted a second time.
3. Gap prompts remove an exact authored term or phrase. `art` does not erase `artist`. Missing source occurrences are held for this game. No sentence or answer is invented.
4. Choice and matching remove ambiguous duplicate normalized terms/meanings from that round. Accepted spellings cannot become alternative correct distractors.
5. The server applies the same eligibility gates. A direct POST for an unanswerable gap returns `409 ineligible_word`.
6. Existing SRS dates, counts and histories remain unchanged by all seven casual game modes. Existing one-point-per-word/per-Tashkent-day deduplication remains authoritative.
7. The misleading matching self-assessment/no-points caption was removed. The existing common server-award policy remains visible.
8. The generated site-guide catalogue contains updated source hashes. No route, CSS token, permission, curriculum, schema or migration changed.

## Open release finding: P3-SEC-01

Severity P0. In an owned database with real login and real ASGI authorization, an unstarted active learner requested `GET /api/listening/full/{id}/authored`. The endpoint returned HTTP 200 and the exact compiled source runtime for Listening Test 2. That source contains the answer-bearing `DATA` object and 70 `answer` properties. The receipt stores counts and a runtime hash, never the keys or original text.

Source: `step21_listening_authored_reads.authored`, `listening_runtime.runtime` and the compiled native study HTML. The endpoint returns the complete source course to preserve its bundled exam/study/review activities. Its sandbox limits execution but does not make embedded answer data confidential.

The protection gate is FAIL. Passing game tests do not close this issue. A safe repair must separate exam-only delivery from authorized study/review data and preserve all original course activities, server grading, persistence and media behavior. Blindly stripping source variables or disabling the course would conceal the dependency and damage existing content. This runtime/material rewrite was not applied. Browser/audio compatibility acceptance belongs to the owner.

## Other limits

- Source inspection shows pinned Listening question rows can fall back to legacy/current rows and submission still reads the current package. Current production metadata reports 62 published snapshots and zero package-question drift. Historical mutation behavior remains an unverified risk, not a reproduced production misgrade. Keep question-ID mapping and aliases in the immutable revision before any future content publication change.
- General Reading is an individual passage-practice contract. Its database membership is `general_practice`; it is not evidence of a distinct General Training examination bank.
- A dedicated Fluency Game route was not found. It is NOT IMPLEMENTED and was not fabricated.
- No published Grammar curriculum, article/course lessons, Podcast records or mock tests were present in the read-only database snapshot.
- Every stored Listening/Reading question has key and explanation fields, but field presence does not verify editorial correctness or source rights. Ninety Reading questions have no `evidence_quote` value.
- The original 67-row comparison and Mentora frontend ZIP were not retrieved. Twenty-three selected PDF pages were visually inspected as static references. No backend, scoring or real-time behavior can be proved from those screenshots. Row-specific Mentora winner claims remain NOT VERIFIED.

## Source/feature matrix

All rows are mapped. PASS-SCOPED means only the specified automated contract passed.

| # | Topic | Observed implementation/content | Fix or no-change reason | Evidence | Status |
|---|---|---|---|---|---|
| 28 | Full Listening | 32 Academic packages, 4 parts/40 questions each; media references exist | Preserve Phase 2 audio/timer code; P0 raw runtime boundary stays open | `browser_listening_exercise.py`, core API finding | BLOCKED |
| 29 | Listening types | 9 stored type-code families, 1,430 questions including MCQ programme | Existing schema/renderers preserved | Registry, baseline tests, aggregate counts | PARTIAL; owner interaction QA |
| 30 | Listening review | Stable question IDs and owned answers; generic review guards exist | Native HTML includes answer-bearing source before review | `browser_listening_exercise.report`, P3-SEC-01 | BLOCKED |
| 31 | Academic Reading | 178 passages, 2,381 questions; 50 sets of 3/40 and 4 authored 3/41 exceptions in raw counts | Preserve split workspace and Phase 2 draft recovery | `browser_reading.py`, `step21_academic_start_port.py`, Phase 2 receipts | PARTIAL; owner split/drag QA |
| 32 | General Reading | 178 passage-practice memberships, no separately proven GT exam bank | Do not relabel/import Academic material as GT | `browser_reading.library`, `general_reading_passages.reading_mode` | BLOCKED; source contract |
| 33 | Articles | Passage study and source-bound word saving exist; no published article/course lesson rows | No new teaching text authored | Curriculum projections and lesson counts | BLOCKED; content |
| 34 | Writing 1/2 | 66 published Task 1 prompts with 66 image references, 78 Task 2 prompts | Existing editor, timer and save lifecycle retained; no invented charts/GT letters | `writing_exam_bank.py`, `exam_lifecycle_port.py`, baseline tests | PARTIAL; owner editor/image QA |
| 35 | Writing feedback | Saved submissions, provider contract and role-scoped review code exist | No external score invented or provider configured | `step32_writing_submit.py`, `step23_grade.py`, baseline tests | PARTIAL; external/manual acceptance |
| 36 | Speaking 1/2/3 | 831/166/697 published prompts; all 166 Part 2 records have follow-ups | Existing related-Part-3 navigation and recording lifecycle retained | `practice.js`, `speaking_catalog_port.py`, baseline tests | PARTIAL; owner mic/recording QA |
| 37 | Speaking mock | General Mock speaking fixed/auto code exists; no standalone Speaking Mock catalogue route or published mocks proved | No sequence or AI score simulated | `mock_speaking_questions.py`, mock tests | PARTIAL |
| 38 | Speaking partner | Matching/leave/relay/token code and signal service source exist | Actual TURN/WebSocket service readiness not exercised | `step24_live_partner.py`, `call-engine.js`, signal server | PARTIAL; owner peer QA |
| 39 | Fluency game | No dedicated route/activity found | Do not create an unapproved scoring system | Speaking route table and entry module | NOT IMPLEMENTED |
| 40 | Podcast | Media pipeline supports media kinds; zero Podcast records in current snapshot | No substitute media/transcript generated | `browser_video.py`, `video_progress_port.py`, aggregate counts | BLOCKED; content |
| 41 | TED/video | 25 published videos, transcript text/source fields present; 1 draft; stored durations zero | Existing private playback-duration fallback retained | Video projections, baseline tests | PARTIAL; owner playback/sync QA |
| 42 | Grammar | 0 topics, 0 exercises, 0 Grammar lessons in snapshot | Existing quiz/evaluation engine retained; curriculum not invented | `browser_curriculum.py`, counts, baseline tests | BLOCKED; curriculum |
| 43 | Vocabulary | Arena 9 fallback packs / 1,782 words; zero DB-published packs, so fallback applies | Materials remain on main as instructed | Pack loader, source inventory, read-only main comparison | PARTIAL; editorial/manual QA |
| 44 | SRS | Server ladder 1/3/7/16/35; owned row locking | Seven game modes preserve dates/counts; concurrent revision advances once | Real PostgreSQL/API receipt | PASS-SCOPED |
| 45 | Games | All 7 API modes exercised | Server verdict/retry, eligibility, ambiguity and duplicate counting repaired | 33 frontend, 86 focused backend, core API checks | PASS-SCOPED; owner browser QA |
| 46 | Retention | 75 active texts, 15 per A2/B1/B2/C1/C2; all have current versions | Source identities and histories preserved | Retention lifecycle/scoring source and baseline tests | PARTIAL; owner lifecycle QA |
| 47 | Explanations | 3,811 key/explanation fields present; 90 Reading evidence quotes absent | No guessed explanations; P0 source leakage unresolved | Counts, evaluator/review trace, P3-SEC-01 | BLOCKED |
| 48 | Mock admin | Authoring, pinned source selection, uploads and manual-grade pipeline exist; zero published mock tests | No live mock created; no General/MCQ source imported | `mock_existing_sources.py`, mock authoring/scoring tests | PARTIAL; owner full lifecycle QA |

## Content and branch boundaries

Arena fallback packs: Food 302, Health 225, Shopping 97, Sports 125, Technology 266, Fashion 152, Work 308, Housing 181, Media 126. All 1,782 have the four required text fields. With exact source gaps, 1,346 are eligible for gap rounds and 436 are held for that mode. They remain saved and usable in appropriate other games. Sixty-five per-pack normalized term/meaning collisions are omitted from ambiguous choice/matching rounds, without deleting vocabulary.

Read-only main has Media 161 and Art 175. These materials were not transferred, staged, committed or pushed to arena. No educational source file, answer key, transcript, image, recording, pack or published material was changed on any branch. Production content aggregates describe the connected main-backed database, not an arena deployment.

## Verification and delivery

The owner changed verification scope during execution. The broad initial frontend/backend runs preceded that instruction. Subsequent work ran only the focused game/backend/API checks and the required static build. No browser session, audio playback, microphone acceptance, network/device exercise or stability run was conducted.

- Initial frontend: 1,404 total, 1,393 passed, 0 failed, 11 existing owner-fixture skips.
- Initial backend: 5,922 passed, 1 environment failure because the isolated copy initially lacked Git metadata. After materialization, that exact build-input check passed. No full-suite final pass is inferred from this correction.
- Final focused frontend: 33 passed, 0 failed, 0 skipped.
- Final focused backend: 86 passed, 0 failed. One inherited dependency deprecation warning.
- Final real PostgreSQL/ASGI/auth: 29 scoped checks passed, 0 scoped failures. One separate P0 release gate FAIL is explicitly retained.
- Final Python static build: 844 files, 131 routes, revision `8694d78d3169db653ab5`. Added one game helper. No Phase 2 performance measurement is inferred from build size.
- `git diff --check`: passed. No migrations or application dependency changes.

Reproduction command: from `services/backend`, run the existing QA Python environment with `tests/phase3_content/core_integration.py --output /absolute/local/receipt-directory`. It creates and closes its own PostgreSQL instance. It cannot accept a production DSN. It needs the existing optional Phase 2 QA dependencies.

The evidence package contains the detailed Uzbek report, exact raw receipts, aggregate inventory, manual handoff and Git proof. Publication is limited to code/tests/documentation on arena with expected-head verification. Main and production deployment remain untouched. No Phase 4/5 work started.
