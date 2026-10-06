# Phase 2 Final Report — Universal Learning Content Operating System

Sections A–BE, in the order §115 asks for. Every status below is *measured*, not
asserted: a claim without a file, a test or a command behind it is written as
`PARTIAL` or `MISSING`, and no browser, provider or row-count behaviour is claimed
that was not actually run in this environment.

**Headline honesty statement.** The canonical system — registries, versioning,
publication, attempt binding, lessons and typed blocks, media lessons, grammar,
vocabulary, mock composition, assignments, identity and migration safety — is
implemented, committed and test-covered. The **learner-facing product surfaces**
(tutor-facing assignment workflow screens, mock exam runner UI, authoring workspace
UI, uniform preview, banks/search, §83–§89 UI re-verification) remain `PARTIAL`. This
report does **not** claim "100% complete" (§115).

---

## A. Mandate

Master Meta-Prompt 2: make Learners Area a universal learning content operating
system — one canonical content model, versioned and published, composed into mocks,
lessons and assignments, attempted under server-authoritative rules, with imports,
authoring and composition kept separate and no parallel mini-platforms.

## B. Base state and git truth

* Branch: `arena/1052c0fd-learners-area` (this session's branch, never switched).
* Accepted base: `31e10bd91667c6f8940e16834d7f7bc3e011b1f5` (ancestry verified earlier
  in the session).
* Phase 2 commits, in order:
  `81acd51` import framework (0040) → `f77482b` taxonomy + question types →
  `578d09a` versioning / attempt binding / score policy (0041) → `121c54b` mocks
  (0042) → `bfff70e` authoring + publication (0043) → `44131b6` lessons + typed
  blocks (0044) → `215069f` TED/Podcast media lessons (0045) → `c8fab7b` vocabulary
  packs (0046) → `ba1686d` assignments over canonical content + grammar integration
  (0047) → `ed39081` source identity + duplicate detection + legacy inventory →
  `d209ebc` the seven remaining `docs/content/*` documents → `b0b5fa6` this report →
  `bc58aa2` gate hygiene (trailing blank line; committed-range base fallback for a
  fresh clone) → `d93b0dd` draft-supersede fix + `listAssignableContent` +
  `/api/assignments/assignable` + AS8–AS10 → `6b050f5` assignment reads through
  `assignment_targets` (multi-student tasks) + AS11 → `033379d` imports pin canonical
  revisions + `content-backfill-imported-versions.ts` + IV1–IV6.
* Local == remote at every commit (verified with `git ls-remote` after each push;
  never force-pushed, never rebased, `main` untouched).

## C. Gates actually run

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean except pre-existing `tests/preview-qa*` errors (unchanged, filtered as before) |
| `npm run lint` | clean (`--max-warnings=0`) |
| `git diff --check` | clean |
| `npm test` | 1193 tests: **1091 pass**, 7 fail, 95 skipped |
| `npm run test:ui` | **222 / 222 pass**, 0 fail |
| `npm run qa:pg` | `migrations ok: 48 / 48`, fixtures ok |
| `npm run build` | see section BE |
| `npm run qa:gate` | see section BE |

The 7 failures are **pre-existing and reproducibly so**: every one of them fails
identically at `c8fab7b` in a clean worktree of that commit
(`reporter` RP14, `navigation-performance`, `section-failure-isolation`, `back-link`,
`ui-error-copy-guard` EG1, `reading-tab-swap`, `preview-qa-migrate`). Phase 2 added
**+83 tests and +82 passes with zero new failures**. Browser acceptance is *not*
claimed: no real browser was driven here, and jsdom is not a browser (§105).

## D. Canonical import foundation

`DONE`. `src/lib/import/core/*` (envelope, parse, validation levels, identity,
dry-run, pipeline, ledger, capabilities, assets, provenance), Reading and Listening
importers that emit canonical structured content **and pin the canonical revision of
what they produced inside the same transaction** (with the ledger row, the target
row and the authorized publication state), zip/JSON transport, PDF text extraction,
private asset staging. Tests: `content-import-framework` 13/13,
`content-import-ledger-schema` 3/3, `content-import-transport` 6/6,
`content-import-versions` 6/6 (one revision per imported item; identical re-import
writes nothing; a conflicting rewrite is refused with the old snapshot intact; an
imported published item is offered to teachers and pins the imported revision).

## E. Content type registry

`DONE`. `src/lib/content/taxonomy.ts`: 8 modules
(listening, reading, writing, speaking, grammar, vocabulary, ted, lesson) with their
content types, tracks, library paths and focus; `referenceProblems`,
`contentTypeKey`, `isKnownContentType`. No learner-visible content may exist outside
a registered module + content type.

## F. Question type registry

`DONE`. `src/lib/content/question-types.ts`: 14 Listening + 16 Reading descriptors
with answer models, five pure grading strategies, import aliases, group/sharing,
accessibility role, review shape and the compatibility storage enum. Answer-shape
validation refuses impossible questions at every door. Tests:
`content-question-type-registry` 11/11. Documented in
[QUESTION-TYPE-REGISTRY.md](QUESTION-TYPE-REGISTRY.md). No CSS lives in question data.

## G. Content versioning

`DONE`. Identity `(module, contentType, sourceRef, versionNo)`, three hashes
(content / semantic / answer-key), immutable published revisions, one writer
(`pinVersion`) used by every door — authoring, Reading import, Listening import,
media lessons, lessons, vocabulary packs, legacy backfill — and snapshots.
Metadata-only edits update the same row instead of manufacturing a version.
A newer **published** revision supersedes the previous one; a newer **draft** does
not, so editing never silently unpublishes what learners were given (a real defect
found and fixed in `d93b0dd`). Tests: `content-versioning` 8/8,
`content-import-versions` 6/6, `content-authoring-publication` 12/12. See
[CONTENT-VERSIONING.md](CONTENT-VERSIONING.md).

## H. Publication workflow

`DONE`. `draft | scheduled | published | archived` with a validated transition
graph, publication gate (`publicationIssues`), scheduling that opens by itself
(`activateDueVersions`), `publicationProblem` diagnostics, and honest refusal of
scheduling where a content row cannot hold a moment (grammar: `unsupported_schedule`).
Tests: `content-authoring-publication` 12/12.

## I. Attempt version binding

`DONE`. `content_version_id` on reading attempts, listening attempts, writing
submissions, speaking attempts, grammar attempts (0047), mock sections/mock attempts
and assignments — and, as of `a617d5b`, the runtime actually writes it: starting a
Reading passage attempt, a Listening test attempt, a Grammar practice/produce attempt
or a Writing submission resolves the published revision through
`src/lib/content/attempt-binding.ts` and stores it. Only a published revision is ever
bound; unversioned (legacy) content is recorded unbound rather than guessed at.
Tests: `content-attempt-binding` AB1–AB3. A bound attempt reads its revision's
snapshot for grading/review, so an answer-key edit after the fact cannot regrade
history (§71/§72).

## J. Listening model

`DONE`. Native structured model (sections → groups → typed questions) produced by the
import path; canonical `listening:full_test` is authorable from scratch; learner
attempts are version-bound; assets stay private. Gap: authoring `section` and
`question_type_practice` content types.

## K. Reading model

`DONE`. The strongest path in the repository: canonical `reading:general_set` import +
conversion, native structured passages and typed questions, Academic and General
Training score policies as separate versioned policies, version-bound attempts,
per-section reporting.

## L. Writing model

`PARTIAL`. `writing:task1` and `writing:task2` are canonical, authored, versioned and
assignable, with submissions bound to the revision and grading through persisted
records (no re-grading on read). `lesson`, `model_text`, `pattern`,
`translation_set` still live on legacy tables (COMPATIBILITY ONLY / MIGRATE).

## M. Speaking bank

`DONE` for the canonical bank: `speaking:part1_question`, `cue_card`,
`part3_question` authored and versioned; attempts bound. `topic_set`, `shadowing`,
`material` remain legacy tables.

## N. Grammar integration

`DONE` (this checkpoint). `grammar:topic` is authored and versioned; learner-facing
reads are publication-gated (`listTopics`, `getTopicWithExercises` filter on
`publication_state = 'published'`), so an authored draft topic is invisible; a grammar
attempt now records the revision it was answered against. Tests: AS7.

## O. Vocabulary: one lexical system

`DONE`. Every Reading, Listening, TED/Podcast, lesson and pack word resolves through
lexeme → sense (`sense_key`) → occurrence/context. Topic packs are canonical content
(`vocabulary:topic_pack`) with the built-in list kept only as a pre-publication
compatibility fallback; publishing a pack makes the DB the source of truth. No
module-local vocabulary store was added. Tests: `content-vocabulary-packs` 5/5.

## P. Lessons and typed blocks

`DONE`. `lesson:lesson` is canonical, versioned and published; blocks are a closed set
(`text | image | audio | video | file | link | quiz | content_reference`), links are
https-only, private assets stay behind `objectKey`, `content_reference` copies
nothing, no executable HTML/JS is ever run, and a learner read never returns answer
keys or explanations before the answer. Tests: `content-lessons-blocks` 8/8.

## Q. Media lessons (TED / Podcast)

`DONE`. `media_kind` (video | audio) plus stable `source_ref` on `video_lessons`;
creating a media lesson pins a canonical `ted:video_lesson` / `ted:audio_lesson`
revision in the same transaction, with the assessment projection covering exactly
what the learner receives (media reference, transcript, notes, questions,
vocabulary). Tests: `content-media-lessons` 5/5.

## R. Mock orchestration

`DONE`. A mock is a first-class orchestration row that owns no content: sections
reference module + content type + source ref + pinned revision. Composition rules
(order, duplicate skills, track purity, question counts, pinned revision for formal
mocks) are enforced by the same function the API calls. Tests:
`content-mock-composition` 13/13. See [MOCK-ARCHITECTURE.md](MOCK-ARCHITECTURE.md).

## S. Mock timing and navigation

`DONE`. `MOCK_TIMING_POLICIES` + per-mock policy id **and** version;
`composeTimingPlan`/`sectionStateAt` derive state from the server clock and the
attempt's `started_at`; navigation is per-mock data (`FORMAL_NAVIGATION` /
`PRACTICE_NAVIGATION`) with formal rules enforced (no pausing, auto-submit,
non-contradictory navigation).

## T. Mock scoring and per-section results

`DONE`. Policies are versioned and the attempt stores `score_policy_version`;
Academic/General Training reading policies differ; per-section raw scores and bands
are stored and surfaced individually and never hidden behind a single number; a
missing part yields `null`, never a fabricated band.

## U. Assignments over canonical content

`DONE`. `createAssignment` resolves the revision through the version store
(draft ⇒ refused, forged/mismatched ⇒ refused), records exactly what the learner will
open, writes one `assignment_targets` row per student with its own status, keeps
`target_user_id`/`related_writing_prompt_id` working for legacy readers, and
`listAssignmentsForStudent` returns only the learner's own tasks.
`listAssignableContent()` offers published revisions only (newest published per item;
drafts, archived and not-yet-scheduled items excluded) and is exposed staff-only at
`/api/assignments/assignable`; both the API and the learner page read through the
service, so a task set for several students reaches every one of them (a second real
defect found and fixed in `6b050f5`). Tests: `content-assignments` **11/11**
(AS1–AS11), covering every case in the assignment checklist including forged version
ids, wrong module/version relationships, roster scope, learner isolation, history
after archive/delete and idempotent status updates. Migration:
`0047_assignments_canonical.sql`.

## V. Role-bound workflows

`PARTIAL`. The rules are implemented and enforced in one place (`mayAssignTo`,
`mayReadAssignment`, `setAssignmentTargetStatus` via `teacher_student_links`,
owner/admin bypass, learner refused) and the assignment route delegates to them.
The **teacher-facing workflow screens** (a roster-aware assignment builder) are not
built.

## W. Source identity and duplicate detection

`DONE`. `src/lib/content/identity.ts`: stable refs from natural keys (never titles),
`classifyIncoming` (new / identical / changed-and-how), `duplicateCandidates` across
different refs (reported, never auto-merged), and normalization reusing the import
core's rule instead of a second one. The import pre-flight
(`/api/admin/content/validate`) returns `duplicates`. Tests: `content-identity` 5/5.

## X. Import vs authoring vs composition

`DONE`. Three separate surfaces (import pipeline; authoring drafts/publication;
mock/lesson/assignment composition) that share exactly one writer
(`pinVersion`) and one publication workflow. Nothing is authored "into" a mock, and a
mock copies no content.

## Y. Validation matrix

`PARTIAL`. Real checks exist at every door: envelope level 1/2 validation, per-type
payload schemas, answer-shape validation, reference resolution, publication gates,
asset requirements, mock composition rules. A single *generated* matrix enumerating
"every content type × every check × its status" is not yet emitted, and this report
does not pretend otherwise.

## Z. Native preview

`PARTIAL`. The import descriptor exposes previews for importable content
(`descriptor.preview`), and canonical content can be read back through the admin
content routes. A uniform preview for every authored draft (before publication,
per content type) is not yet in place.

## AA. Authoring workspace

`PARTIAL`. The API surface is complete
(`/api/admin/content/authoring-capabilities`, `drafts`, `items`,
`items/[module]/[contentType]/[sourceRef]`, `versions/[id]/publication`, `validate`,
`template`, `import`) and 10 content types are authorable from scratch. The admin
workspace UI over those routes is minimal.

## AB. AI output rules

`DONE`. AI-produced content enters as a payload through `saveContentDraft`, is
validated by the same schema and answer-shape rules as human content, is marked
`origin: ai` in provenance, and **has no publish authority**: publication is a human
action with a named actor.

## AC. Banks, taxonomy, search, filters

`PARTIAL`. Taxonomy and content types are canonical and queryable; the speaking bank
and vocabulary packs are canonical. Cross-content bank/search/filter surfaces over
canonical content are incomplete.

## AD. Attempts, autosave, resume, retry, review, progress

`PARTIAL`. Per-skill attempts, review from the bound revision, progress and history
exist (Reading, Listening, Writing, Speaking, Grammar, lessons). Not yet uniform
across every canonical content type, and there is no single cross-skill attempt
timeline.

## AE. Mock builder and compatibility rules

`DONE` for the composition engine and compatibility rules; `PARTIAL` for the builder
UI and the learner exam runner (the composition object, timers, navigation policy,
section scores and bindings are complete; the section-by-section formal runner is not
wired end-to-end on top of them).

## AF. Learning paths and locks

`PARTIAL`. Courses → modules → units → lessons exist with lesson progress.
Path-level locking/prerequisite rules are not yet canonical content or policy.

## AG. Future-course reuse

`DONE` architecturally. Content is not bound to a course: a lesson, mock or
assignment references canonical content by identity/version, so a future course
reuses the same items. No IELTS assumption is baked into shared infrastructure
(§3/§68).

## AH. Thin HTTP + services

`DONE` for the content surfaces: routes authenticate/validate and delegate to
services (`src/lib/content/*`); business rules live in services, not in route
handlers.

## AI. Storage and JSONB policy

`DONE`. Normalized relational tables for content, versions, sections, questions,
targets and attempts; JSONB is used only for bounded metadata
(content snapshots, navigation policy, timing/score policy refs, provenance). No
untyped content blob.

## AJ. Audit, provenance, copyright boundaries

`DONE`. Every revision carries provenance and a named actor; publication and
assignment operations record actor + reason; assets are private; no copyrighted
IELTS question text was copied in, and external provider material is flagged
`MANUAL REVIEW REQUIRED` in the inventory (§75/§96).

## AK. RIWI boundaries

`DONE` (unchanged). RIWI evaluation records and provider boundaries are untouched by
Phase 2; no RIWI branch was merged, and no content-publish path was routed through
RIWI.

## AL. Retention

`PARTIAL`. Retention texts/attempts/rotation exist as their own (legacy) tables;
they are not yet canonical `vocabulary:retention_text` content and are classified
COMPATIBILITY ONLY / MIGRATE in the inventory.

## AM. Private assets

`DONE`. Uploaded audio/image assets are private objects addressed by `objectKey`;
nothing public-path is generated for learner content, and R2 is never made public.

## AN. Performance

`UNVERIFIED` in this environment beyond the existing gates: no load test or
production-profile performance run was executed for Phase 2 surfaces. The
repository-level performance tests that exist (`navigation-performance`) fail
pre-existing, as recorded in section C.

## AO. Answer-key security

`DONE`. Answer keys live on the server, are published only after answering, and
learner reads are shape-checked (lesson blocks return no key/explanation before an
answer; review reads the bound revision). Publication refuses a missing answer key
where one is required.

## AP. Randomization

`PARTIAL`. Answer/option randomization only exists where it already did; a
server-side stable-randomization contract for every content type (§82) is not yet
implemented. Not claimed.

## AQ. Accessibility and responsive

`PARTIAL`. Question types declare an accessibility role (radio/checkbox group,
labelled text input, select-from-pool), and `test:ui` 222/222 covers existing
screens. A full accessibility and responsive re-verification of the Phase 2 screens
was not performed (§83/§84 remain open; no jsdom pass is claimed as accessibility
acceptance).

## AR. Design tokens, focus contracts, content cards, owner preview

`PARTIAL`. Existing tokens/focus/card conventions were not weakened and no new UI
system was introduced; §85–§89 as *product* requirements are not yet re-verified
after Phase 2.

## AS. Coverage matrix

`DONE` as a document, honest as a claim:
[IELTS-COVERAGE-MATRIX.md](IELTS-COVERAGE-MATRIX.md) lists per-skill, per-track state
with the named gap for every `PARTIAL`/`MISSING` row (§91).

## AT. Content map

`DONE`. [LEARNERS-AREA-CONTENT-MAP.md](LEARNERS-AREA-CONTENT-MAP.md) maps every
concern to its file, route and table, including the legacy/compatibility list (§92).

## AU. Legacy inventory

`DONE`. `scripts/content-legacy-inventory.ts` classifies 12 items: 6 KEEP, 4
COMPATIBILITY ONLY, 1 MIGRATE, 1 MANUAL REVIEW REQUIRED, **0 REMOVE AFTER MIGRATION**
— because nothing is yet proven safe to delete. A MIGRATE or REMOVE verdict must name
its successor or the inventory fails. Nothing was deleted (§93/§94).

## AV. Migration tooling

`DONE`. Two idempotent, dry-run-first, named-actor backfills —
`scripts/content-backfill-vocabulary-packs.ts` (built-in packs → canonical content)
and `scripts/content-backfill-imported-versions.ts` (Reading sets and Listening
packages imported before the importers pinned revisions; it reads only stored rows,
reports what it cannot version instead of guessing, and is a no-op on a second run) —
plus an import ledger that records which package produced which revision and identity
checks (`classifyIncoming`) that make "no new data" the honest answer when nothing
changed. Verified against the local QA PostgreSQL, not only in unit tests. Data is
never invented (§95).

## AW. Synthetic fixtures

`DONE`. All Phase 2 tests and scripts use synthetic content (names like "Synthetic
assigned prompt, version one."), and no copyrighted IELTS question text exists in
fixtures, seeds or docs (§96).

## AX. Owner acceptance for the four skills

`PARTIAL`. Repository-level acceptance is real and green for the canonical flows
(import → version → publish → attempt → score → review per skill, plus 96 passing
content-suite tests). Owner-level end-to-end acceptance **in a browser** was not
performed and is not claimed (§97).

## AY. Full Academic mock end-to-end

`PARTIAL`. Composition, compatibility rules, pinned revisions, timing plan,
navigation policy, section-by-section results and overall band assembly are
implemented and tested at the service level (`content-mock-composition` 13/13).
A full learner exam run of a complete Academic mock (browser, all four skills,
timers under exam conditions) has **not** been executed end-to-end (§98 open).

## AZ. Assignment end-to-end with role boundaries

`PARTIAL`. The service and API level is complete and tested
(`content-assignments` 7/7: roster boundaries, draft refusal, forged revision
refusal, per-student status, learner isolation, archived content still visible to the
student who was given it). The teacher-facing screens for that flow are not built
(§99 partially open).

## BA. No deployment per content

`DONE`. No React change, commit, push or deploy was made for any individual
Listening/Reading test, Writing prompt, Speaking question, lesson, TED/Podcast lesson
or mock: content flows through the import/authoring surfaces, not through code
(§100).

## BB. No parallel mini-platforms

`DONE`. One canonical layer, one version store, one writer, one publication workflow,
one lexical system, one mock orchestration model. Phase 2 added no second content
database, no second vocabulary store, no second mock engine, and no per-content
deploy path (§101).

## BC. Security tests

`DONE` where implemented: roster boundaries (AS1), forged/mismatched revisions (AS3),
learner isolation (AS5), publication gating (AU/VP/AS7), private assets, answer-key
withholding, EG-style UI error-copy guard (pre-existing failure honestly recorded).
Not every §102 item has a dedicated new test; the matrix in section Y stands.

## BD. Data-integrity tests

`DONE` where implemented: version identity and immutability (CV), attempt binding,
publication state machine (AU), assignment pinning and archiving (AS2/AS6),
one-lexeme-per-sense (VP), duplicate detection (SI), migration count `48 / 48`
(`npm run qa:pg`). No historical attempt is mutated by any Phase 2 code path.

## BE. Engineering gates, browser QA, performance QA, migration safety, and the final statement

* Engineering gates: `typecheck` clean (modulo pre-existing preview-qa errors),
  `lint` clean, `git diff --check` clean, `npm test` 1091 pass / 7 pre-existing fail /
  95 skip, `npm run test:ui` 222/222, `npm run qa:pg` migrations 48/48. `npm run build`
  and `npm run qa:gate` results are appended in the addendum below once the full gate
  run completes; if they are not green, they are reported as-is.
* Browser QA (`§105`): **not performed** — not claimed.
* Performance QA (`§106`): **not performed** — not claimed.
* Migration safety (`§107`): migrations are additive only, the journal grew by hand
  (never `drizzle-kit generate`), and `qa:pg` applies all 48 in order on a fresh
  database before fixtures.
* **This report does not say "100% complete."** The implemented, verified surface is
  listed above as `DONE`; the remaining work is listed as `PARTIAL`/`MISSING`/`UNVERIFIED`
  with the specific gap. The next Phase 2 checkpoints, in the agreed order, are:
  role-bound assignment workflows (screens) → validation matrix generation → native
  preview for every content type → authoring workspace UI → banks/search → mock
  builder + learner exam runner → uniform attempts/review surfaces → §83–§89 UI
  re-verification → browser and performance QA → owner acceptance (§97/§98/§99).
