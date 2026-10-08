# Reading V4 — implementation checkpoints (not frozen)

Baseline: `2b5f07e0c11375fa8235feafa09e0ce333b58a43`; branch `arena/1052c0fd-learners-area`.
Migration journal remains at 53 entries. No migration has been introduced.

## Lessons: 935bf8c

Reading index/detail/staff adapters use the generic lesson library with explicit
`learning_area=reading`, existing versioned lesson bodies, teacher notes, and private
(user, stable lesson) notes. No second lesson store or student admin entry.

Focused lesson / private-note / Listening reuse regressions: 25 total, 25 pass,
0 fail, 0 skip. Typecheck and lint pass. Local and remote SHA equality verified.
Vercel commit status: success, Deployment has completed (checked separately).

## Doorway and bounded discovery

- Five product destinations, History secondary. No catalogue queries on the root.
- Legacy General Training was a distinct empty tab: its old URL returns to the
  doorway, not to unrelated learning/history. Existing practice aliases preserve
  their actual prior interpretation. Filter-only bookmarks remain General library
  bookmarks, including `type`; they are not silently reassigned to Question Types.
- General retains the existing URL-backed, DB-filtered 24-card learning library,
  concurrent/independent facet and library regions, and canonical passage links.
  Set pagination uses `setsPage`; the prior `page` still means library page.
- Academic catalogue applies three authored live slots and nonempty question
  membership before pagination. Start page remains explicit. This is discovery
  validation, not proof of immutable attempt content or start-API safety.
- Question Types derives canonical identities/alias compatibility from the shared
  registry, intersects published material, uses distinct facets and EXISTS passage
  membership, and bounds pages to 24 plus a sentinel. General practice explicitly
  says the whole passage opens rather than claiming type-only focus.

Focused doorway + actual PGlite catalogue/type-index SQL: 6 total, 6 pass,
0 fail, 0 skip. Typecheck/lint pass. These are NOT built-server HTTP or browser tests.

## Open release blockers / remaining verification

Academic immutable V1/V2 read/grade/history and deletion safety are unresolved.
Active-exam highlight, post-submit eligible Dictionary, General Check explanation,
registry-complete rendering/import, and Retention direct-entry audit remain open.
No Reading production freeze, fresh full gate, QA2 HTTP campaign, or Reading Vercel
release claim has been made. Prior Listening/TED full-gate results are not Reading
V4 evidence. Pointer/highlight and 390/768/1440 rendering: externally unverified.

## General Check: df23a15

Server returns authored explanation and evidence only on explicit Check; UI renders
both as plain support text and labels missing source rather than inventing it.
Check/save also gates the individual passage's publication, not only its parent set.
PGlite behavioral test: 1/1 pass, no fail/skip. General DOM suite: 5/5 pass,
no fail/skip. Typecheck/lint/diff check pass. Remote equality verified; Vercel
status success, Deployment has completed (checked separately).

## Shared highlight integration

Academic and General use the existing ClickableText offset renderer. Lexical-off
text can explicitly opt into highlighting without word targets, popup, lookup,
or occurrence props. Native-selection offsets and removal keep text unchanged;
keyboard selection can expose the highlight control. General retains Dictionary
and occurrence-based lookup. Reading highlight state is mounted owner/attempt
memory only: passage tabs retain it, leaving/reload clears it; no storage/schema
or cross-device persistence is claimed.

Reading/General/shared highlight DOM suite: 15 total, 15 pass, 0 fail, 0 skip.
Listening controls/section highlights/notes/results and TED closure/UX/voice DOM
regressions: 95 total, 95 pass, 0 fail, 0 skip. Reading V4 focused unit/SQL group:
8 total, 8 pass, 0 fail, 0 skip. Typecheck/lint/diff check pass. Real pointer and
viewport painting remain externally unverified. These suites overlap earlier
checkpoint suites and must not be summed as a full-gate total.

The open-blocker list above is historical at the discovery checkpoint: General
explanation and highlight implementation now exist with this focused evidence.
Academic V1/V2 history remains P0: `persistReading` in `content/authors.ts` deletes
existing passages by sourceRef; attempt foreign keys can block draft creation,
and question answer rows have cascading deletion. No migration has been proposed
or created; the existing version target/snapshot capability needs a safe Reading
materialization design and a real draft/publish/old-attempt proof before closure.
Academic review Dictionary, registry-complete import/rendering, HTTP and fresh
full-gate verification remain open. Nothing here declares the repository frozen.

## Continuation from e21eb70 — non-destructive Reading revisions

Current checkout metadata initially named 31e10bd. All 1,550 tracked files matched
remote e21eb70 exactly before guarded metadata-only recovery; no worktree replacement.

Reading authoring now retains canonical passage/question rows per revision. The
existing content_versions target and contentSnapshot carry exact passage/set IDs;
logical sourceRef/provenance stays intact. New revisions create draft targets in the
EXISTING tables. Publication withdraws the prior revision without deletion. Existing
attempt membership and question foreign keys therefore remain valid for read/grade.
No shadow content table, second exam, schema change, or migration was introduced.

The native question editor only appends to unused, non-version-owned drafts. Native
passage creation is draft-first. Standalone starts serialize with editing/publication;
formal starts capture the published revision and lock the set against withdrawal.
New formal entries require exactly three real slots and 40 actual questions. Learning
sets and historical attempts are not rewritten to meet the formal-entry contract.

The existing atomic submit moved into a testable service used by the SAME API. A
secondary activity-refresh failure cannot falsely report a committed grade as failed.

PGlite journey exercises real authoring/publication/start/read/autosave/submit code:
V1 start + resume + 40 drafts; V2 draft leaves V1 unchanged; V2 publication withdraws
old starts, keeps A's rows, and gives B new rows/binding; cross-user denial; editor
refusal; forced SQL failure rolls back grade/answer replacement; retry grades V1;
repeat submit/autosave cannot alter the completed result. Both question sets remain.

Authoring + history + timer-lock regression batch: 24 total / 24 pass / 0 fail / 0 skip.
Reading V4 + binding + timer-lock batch: 18 total / 18 pass / 0 fail / 0 skip.
Typecheck/lint pass. Batches overlap. This is not a full gate or built-server proof.

## Registry convergence (Reading-only)

The canonical registry now drives Reading answer models and grading on BOTH
existing engines. General reuses ReadingExam's question/group/stimulus presentation;
there is no General copy of the type switch. All 16 types are exercised through the
real importer, canonical tables and General Check, and through rendered controls.
Multi-select rejects extra/duplicate selections in the Reading adapter without
changing frozen Listening grading. Authored constraints and alternatives are kept.

Bundle and Content OS authoring retain groups/instructions/options/constraints.
Question rows hold canonical IDs; the existing 16-character group source-code field
uses registered aliases, resolving back to the same registry. No column widening,
new question tables or migration is needed. Learner constraint props are explicitly
projected rather than forwarding arbitrary JSON. Review type identity and missing
source support are explicit; correct answers are shown even when answered correctly.

General retains independent per-passage queues/debounce. Check and autosaves are
serialized per passage; a stale response cannot paint a newer answer as checked.
Editing clears the current result and server checked state on autosave.

Focused Reading/registry/authoring/import batch: 57 total / 57 pass / 0 fail / 0 skip.
Registry controls + General + Academic separation DOM batch: 27 total / 27 pass /
0 fail / 0 skip. Typecheck/lint pass. No Reading full-gate/HTTP closure claim yet.

## Submitted-review Dictionary scope checkpoint

Own submitted Academic reviews use the existing canonical Dictionary. Server
lookup and save-source policy validate immutable assessment membership for all
three passages; an active overlapping assessment still locks that review. Foreign
attempts/occurrences are rejected. Archived rows remain usable through an owned
submitted attempt, not a bare archived passage ID. Explicit published General
learning stays independent. No new vocabulary store or schema was added.

Combined review occurrence offsets match the actual title/body separators. The
review component enables existing ClickableText; active ReadingExam receives no
occurrences. Question-type entry retains the requested canonical type and clearly
identifies whole-passage practice. General canonical type filtering remains an
EXISTS query. Formal start additionally rejects an empty-question passage, and a
partially unpublished General set is not served as a complete student detail.

Evidence (overlapping batches, not summed):
- Focused V4/history/import/tab/stabilization: 44 total / 44 pass / 0 fail / 0 skip.
- Reading/General/shared-highlight DOM: 32 total / 32 pass / 0 fail / 0 skip.
- Native PostgreSQL Academic + General: 27 total / 27 pass / 0 fail / 0 skip.
- New SQL-backed review-membership case: 1 total / 1 pass / 0 fail / 0 skip,
  included in the 44-test batch; covers all three occurrences, ownership,
  overlapping retake denial, preserved General learning and archived review.
- Typecheck, lint and diff-check pass. Migration journal remains 53/53.

A fresh isolated QA2 PostgreSQL was bootstrapped after confirming no server was
reachable; this is not a claim that fixtures from a previous ephemeral runtime
survived. No production/preview database was used. Native integration tests are
not the still-pending exact-ID-cleaned built-server HTTP acceptance.

Prior checkpoint 9dd8a6d: actual GitHub Vercel status verified success.
Scheduled activation/binding, checked-detail reload, active-help audit, runtime
HTTP/roles, final gate and ledger closure remain outstanding. No completion or
browser-pointer/viewport claim is made.

## General checked-detail restoration checkpoint

A learner's persisted Check now restores the same server-owned correct answer,
accepted alternatives, authored evidence/explanation and missing-source states
on reload. It does not perform another Check, write progress, or unlock an
unchecked draft. An edit immediately removes displayed feedback and score; its
existing autosave clears persisted checked state. The restored projection refuses
mismatched passage/question counts or a score inconsistent with persisted answers.
Existing answers/checkedAt/score/total are sufficient: no migration or new store.
General requested-type labels now use localized canonical identity and only show
when that type is actually present in the selected passage(s).

Fresh focused checks (overlapping, not summed):
- V4/history/import/tab/stabilization: 45 total / 45 pass / 0 fail / 0 skip.
- Reading/General/shared-highlight DOM: 33 total / 33 pass / 0 fail / 0 skip.
- Native PostgreSQL Academic + General final rerun: 27 total / 27 pass / 0 fail /
  0 skip. An earlier rerun was 27 / 26 / 1 / 0: a QA assertion assumed every new
  fixture was on catalogue page one. It now follows bounded pages, asserts the
  25-row lookahead limit, and checks the actual fixture ID; production pagination
  was not widened, assertions were not removed, and the database was not reset.
- New checked-review SQL case: 1/1/0/0 (included in the 45-test batch).
- General DOM alone: 6/6/0/0 (included in the 33-test batch).
- Typecheck/lint/diff-check pass. e612aa1 actual Vercel status: success.

This closes the implementation/component/SQL reload gap, not built-server HTTP
reload acceptance. Scheduled activation/binding and formal publication policy,
active-help audit, real lookup/save HTTP/roles/Retention journeys, final gate and
ledger closure remain open. Real pointer/highlight and 390/768/1440 acceptance
remain EXTERNALLY UNVERIFIED. Background/Night Mode: NOT STARTED—DEFERRED BY OWNER.

## Final product continuation — lifecycle and source fidelity

Initial local Git metadata reported 31e10bd while the remote was e7a0e13. Every
one of e7a0e13's 1,558 tracked files matched its Git blob exactly. Only after that
proof, branch/index metadata was advanced to e7a0e13 without writing worktree
files. No reset, checkout, stash, clean or branch switch occurred.

Reading-only scheduled activation now calls the existing Content OS publisher
in bounded 100-revision transactions before catalogue/start reads. Future
schedules stay closed; newest due revisions win; obsolete due schedules are
archived; old attempts keep immutable rows; new starts bind published revisions.
Legacy unversioned schedules retain their publication-window contract.

Formal admission policy: a published, same-set, three-passage structure with all
three nonempty question sets and exactly 40 actual questions is required by
Academic catalogue/detail/start. General learning publication remains valid for
smaller authored sets; source track or title is not treated as a new formal-test
flag. No synthetic padding or ban on legitimate partial General materials.

Active Academic exams no longer receive unrestricted attachment blocks or
read-aloud help. Authored shared-stimulus identities stay passage-local while
full-test displayed numbers are global. Exact authored evidence is located only
within its question's source passage; a missing match remains explicitly missing.
Reading lesson text and submitted review reuse the existing Reading highlight
adapter. Annotation lifetime remains mounted owner/source only, never a new
cross-device persistence claim.

Reading Lessons reuse LessonWorkspace's progress controls without a duplicate
note pad. Shared state API publication checks now reject drafts, and per-user
lesson transitions serialize inside a transaction. Existing private notes remain
separate; other LessonWorkspace callers keep their previous note UI by default.
Native Reading authoring allows an absent explanation rather than requiring an
invented rationale.

Checkpoint: focused Reading/authoring/private-note SQL 54/54/0/0; focused DOM
41/41/0/0; typecheck/lint/diff-check pass. Migration count remains 53. Full gate
and built-server acceptance follow this production-code checkpoint.

## Reading V4 final acceptance

Runtime proof, not source inspection:

- Built-server HTTP journeys, `scripts/verify-reading-v4.mjs`: **78 checks, 78 pass,
  0 fail**, residue 0. Five products, legacy URLs, lessons + private notes, an
  Academic full test end to end (start → autosave → secrecy → submit → review),
  General 1/2/3/FULL with explicit Check, the type index, direct Retention,
  history, cross-user isolation and four roles.
- REAL Chromium acceptance, `scripts/verify-reading-browser.mjs`: **35 checks, 35
  pass, 0 fail**, residue 0. Pointer-drag highlighting at the right offsets, text
  unchanged, removal, the Dictionary popover on a real click, no lexical target in
  an active exam, all forty questions reachable through real part navigation, and
  390 / 768 / 1440 CSS px with no horizontal overflow and no console error.
  Reading highlight/pointer/viewport behaviour is therefore EXECUTED, not inferred.

Defects this round found and fixed, each in its own commit:
- `activateReadingSchedules` — due Reading revisions were never activated; old
  attempts keep their rows, new starts bind the newest due revision, superseded
  schedules archive. Reading-only, bounded, through the existing publisher.
- The active Academic exam shipped unrestricted attachment blocks and a
  read-aloud control; both are gone from the exam path.
- Shared-stimulus blanks used global full-test numbers, so a three-passage paper
  could not match its authored slots; authored identity is preserved separately.
- Lesson progress accepted a draft lesson and raced per learner.
- Three Uzbek Reading labels used typographic apostrophes; withdrawn "General
  Training" copy still shipped to the browser.
- An older vocabulary assertion still demanded that a SUBMITTED own attempt stay
  locked, contradicting the accepted review-Dictionary contract; reconciled and
  strengthened (retake and never-submitted locks now both asserted).

Browser binary: Chromium 1248 via `@sparticuz/chromium` with its AL2023 libraries,
driven by `playwright-core`. Pass `CHROMIUM_PATH` to reproduce.

## Independent re-verification (commit f3641ac)

The whole acceptance set was re-executed from a clean checkout in a later session,
after `npm ci`, with no inherited build or database state.

- Full gate, `QA_OUT=/tmp/rv4-gate-f3641ac`: unit-pglite 1489 total / 1392 pass /
  0 fail / 97 skipped; ui 313 / 313 / 0 / 0; real-pg 1489 / 1485 / 0 fail / 4
  skipped; typecheck, lint, build, diff-check and diff-check-range all exit 0 —
  **GATE PASS**. Migrations 53 / 53, unchanged.
- Built-server HTTP journeys: 78 / 78, 0 fail, residue 0.
- REAL Chromium: 35 / 35, 0 fail, residue 0.

One genuine defect surfaced by the re-run: `ReadingLearningLibrary.tsx` ended with
a blank line at EOF, which `git diff --check <pinned base> HEAD` rejects. The
pinned base commit is not present in every clone; when it is missing the gate
falls back to a different base and the range check can silently change meaning.
Fetch the pinned base before trusting `diff-check-range`. The trailing line is
removed in f3641ac; no behaviour changed.

The 97 unit skips are isolated-database tests that RUN in the real-pg leg. The 4
real-pg skips are owner assets only: the frozen dictionary catalogue (2) and the
Listening source ZIP (2). Skipped is never counted as passed.

## Final closure round — publication truth and the exam seal

### Scheduled activation (PUB-01…PUB-15)

`tests/reading-v4-scheduled-activation.test.ts` drives `activateReadingSchedules`
with a CONTROLLED clock (`now`), never a sleep towards a real moment:

- before T the live revision is still startable and the future one is neither
  visible in the catalogue nor startable (PUB-02, PUB-14);
- at T the one activation authority publishes it, and the catalogue, the set
  start and the attempt binding all agree (PUB-03, PUB-04);
- a learner who began before T keeps their questions and is graded on their own
  keys after T (PUB-05, PUB-06), while a learner starting after T receives a pure
  newer set with not one older question in it (PUB-07, PUB-08);
- nothing is deleted and the submitted review still reads its own revision
  (PUB-09, PUB-10); the superseded revision refuses a new start (PUB-13);
- a schedule with no moment is refused, and a stray moment on a non-scheduled
  transition is normalised to null rather than stored (PUB-12);
- a draft is invisible to learners while its rows stay readable for staff (PUB-15);
- PUB-11 runs on REAL PostgreSQL with separate pooled connections: eight
  concurrent activations and starts produce exactly one published revision and no
  partial membership.

`tests/reading-v4-history-invariants.test.ts` adds the replay, legacy-binding,
unrelated-source and concurrency invariants (RV-HIST-09, 11, 12, 14). A replayed
publication is a SAFE REFUSED NO-OP: the shared CMS contract rejects a `from === to`
transition for every module, and the refusal changes no membership, no catalogue
row and no bound attempt. RV-HIST-14 races four autosaves, a publication and four
submits on real PostgreSQL: exactly one submit grades, on the attempt's own keys.

### SEC-12 — a real active-exam bypass, found and closed

Migration 0030 pins every `general_reading_passages.reading_mode` to
`'general_practice'` by CHECK, and an Academic formal test is built from those same
canonical rows. A `reading_attempts` row stores only its FIRST passage — positions
two and three exist solely in `reading_assessment_passages`. So a learner sitting an
open three-passage assessment could ask for the very same passage by its PASSAGE id
and be served Dictionary meanings as "General learning", including through an older
submitted attempt of that passage.

`readingLexicalAccess` now checks exam integrity BEFORE product classification: if
the learner has an open attempt whose assessment membership contains this passage,
the mode is `ACADEMIC_EXAM`. Only a formal assessment seals — a standalone passage
attempt and ordinary General learning are untouched, and everything re-opens once
the assessment is submitted.

Proof: `tests/reading-v4-exam-seal.test.ts` (fails without the fix, verified by
restoring the pre-fix file), and nine new built-server checks A16.1/2/3 + b + c,
which seal the passage-id route, the attempt-id route and the vocabulary save at
all three positions. Two older assertions that encoded the weaker policy
(`reading-v4-review-access`, `academic-reading-qa2`) were updated to the tightened
contract, with the re-opening after submission asserted in both.

### General Check (GEN-01…GEN-12)

GEN-06 is now proven directly: `tests/ui/general-reading.test.tsx` holds a Check
response in flight, edits an answer before it lands and asserts the overtaken reply
paints no result, no score and no stale authored explanation.

### Runtime acceptance on the frozen tree

- Built-server HTTP `scripts/verify-reading-v4.mjs`: **93 checks, 93 pass, 0 fail**,
  residue 0.
- REAL Chromium `scripts/verify-reading-browser.mjs`: **35 checks, 35 pass, 0 fail**,
  residue 0.

`scripts/verify-reading.mjs` is PRE-V4 and is marked superseded in its own header:
it is in no gate and no npm script, and its expectations (tabbed hub, read-aloud in
the attempt, spelling lookup from a passage) contradict the approved V4 contract.
It was not satisfied by weakening any product rule.
