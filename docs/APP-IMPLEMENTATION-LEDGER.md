# Requirement ledger — Best-of-both `/app` V4

Status vocabulary, and it is used literally:
`NOT STARTED` · `IN PROGRESS` · `DONE` · `BLOCKED — OWNER` · `BLOCKED — EXTERNAL` · `NOT APPLICABLE — PROVEN`.

The ledger is the source of truth for progress. A line becomes `DONE` only when the
repository itself proves it (code + a focused test + the gates), never because the plan
says so.

## How this ledger is ordered

Work proceeds in the phases the owner defined (§62). Phase A and Phase B are complete and
committed; the remaining phases are open and are being worked in order.

| ID | Requirement | Status | Evidence / note |
| --- | --- | --- | --- |
| APP-001 | canonical `/app` namespace | **DONE** | `src/app/app/{layout.tsx,(shell),(focus)}`; `/app` **is** the dashboard; every authenticated page is under `/app`; APIs stay at `/api`. `tests/app-namespace.test.ts` (6 tests) |
| APP-002 | design preserved | **IN PROGRESS** | no token, class or primitive was changed by the move; the shell layout is the same markup, re-parented. Before/after capture is still owed (§65) |
| APP-003 | performance baseline | **NOT STARTED** | no baseline has been recorded yet; §4/§66 require measurements before any claim |
| LSN-001 | Listening Lessons | **DONE** | `/app/listening/lessons` (library) + `/app/listening/lessons/[lessonId]` (lesson) on the canonical lesson layer, classified by the AUTHORED learning area (`lessons.learning_area`, 0050) through the generic, area-driven reader `src/lib/content/lesson-library.ts`; the media-derived module stays DELETED. Proven by L1–L16, the 0050 migration proofs (`docs/MIGRATION-APPROVAL-0050.md`), the built-server smoke **43/43** and the lesson-authoring safety scenario **62/62**, then re-proven on the frozen tree by the full gate (unit 1309/1213 pass 0 fail, ui 247/247, qa:pg 51/51, real-PG 1309/1305 pass 0 fail). The owner accepted the corrected contract on 2026-10-06 |
| LSN-002 | Description | **DONE** | the tab reads authored columns only (`lessons.summary` plus the attached media's `before_you_watch`) and says so when they are empty (LL4 + runtime smoke) |
| LSN-003 | Teacher Notes | **DONE** | lesson-level Teacher Notes on `lessons.teacher_notes` (0050), authored through the single content pipeline and carried by the pinned revision; the learner page shows the lesson-level notes with the attached media item's `video_lessons.notes` as a read-time COMPATIBILITY fallback that lesson-level notes always win over. Proven by L5–L8 and L16, the authoring-desk hydration tests (E1–E6, plus the desk's own UI case), the built-server smokes 43/43 + 62/62 and the full gate above; the owner accepted the corrected contract on 2026-10-06 |
| LSN-004 | private Student Notes (Xulosangiz) | **DONE** | the third tab on the listening lesson page renders `LessonNotesPanel` with the learner's own note from `lesson_notes` (0049), keyed by the lesson's stable id — there is no second notes system. Runtime: the author sees the note on their own page, the owner sees an empty box for the same lesson |
| LSN-005 | Academic catalogue | **DONE** | `/app/listening/academic` lists the canonical PUBLISHED Academic FULL TESTS from `src/lib/data/listening-academic.ts`, decided by the ONE product classifier (`src/lib/listening/product.ts`): the authored content-version type, then the authored `collection`, then a package with no collection ONLY when its structure proves a formal full test (4 parts / 40 questions). A dedicated MCQ package and question-type practice are legitimate content that is **NOT** an academic full test and are no longer listed as one (their canonical identity is unchanged in the database) — the older rule that folded `question_types`/`mcq`, and a missing collection, into the catalogue was **superseded by the owner's directive on 2026-10-07** (see the classification & pagination correction below). Membership and `liveWhere` are WHERE clauses applied BEFORE the bound, never a post-filter; drafts are invisible. Ordering is the authored sequence (`created_at`, `source_ref`, `id`) because `listening_tests` carries NO ordering column — a display title is never parsed and no migration was added |
| LSN-006 | dynamic 5–10 activity hub | **DONE** | `src/lib/listening/activities.ts` is the single authority and BOTH hubs are driven by it: the existing `/app/listening/tests/[id]` and the new `/app/listening/academic/[testId]`. Support is decided from authored facts: a declared activity whose content does not exist is filtered out, Script Completion needs authored blanks across the full transcript, the graded drills need the kind the source authored (which is also the route's own precondition, so no card points at a 404), and Matching is never filed as MCQ; Review needs a submitted attempt and Retry Weak Areas needs genuinely missed questions. Counts follow authoring (2–8 in the fixtures) and are never forced to ten; empty, fake and disabled cards do not exist. See the checkpoint below |
| LSN-007 | formal exam | NOT STARTED | strong native focus exam already exists under `/app/listening/tests/[id]` (focus group) |
| LSN-008 | review evidence | NOT STARTED | revision/study surfaces exist |
| LSN-009 | Script Completion (full transcript, 5–7 blanks/part) | NOT STARTED | the exercise exists (activity 3 renders the WHOLE transcript with the authored blanks; the QA fixtures carry 6–7 per part), and the registry now refuses to offer it for a recording whose transcript has no authored blanks instead of dressing a transcript up as a completion. Re-deriving every part's blanks from the OWNER'S SOURCE ZIP is still the owner asset the inventory requires, so the row stays NOT STARTED |
| LSN-010 | MCQ Mastery reuse | **IN PROGRESS** | server-authoritative staged engine already exists (`src/lib/services/listening/mcq-{access,payload,mastery}.ts`, `McqMastery.tsx`); the day program must reuse it, not duplicate it |
| LSN-011 | Matching practice | NOT STARTED | the graded route (`/app/listening/tests/[id]/matching` → `POST /api/listening/full/:id/practice`) exists and is now offered on a hub ONLY when the source authored `matching` into its study pack (proven in the Academic checkpoint). Acceptance of the practice itself has not been performed, so the row stays NOT STARTED |
| LSN-012 | Completion practice | NOT STARTED | the graded route (`.../completion`) exists and is now offered only for an authored `completion`, and the hub draws on real question types (Matching/Completion/MCQ) only. Acceptance pending, as with LSN-011 |
| LSN-013 | Listening vocabulary (canonical lexical) | **IN PROGRESS** | the ONE canonical lexical architecture is now reachable from a General section: the section asks the canonical API with the canonical `listening` source identity, and a lookup in a section is answered while the learner works in it (`SECTION_PRACTICE`), while a running Academic full exam stays sealed (M21 unchanged, M21b, smoke L9/L9b). No table, no second dictionary, no pre-submission answer material. The persisted cross-device vocabulary work and the owner's frozen dictionary catalog are still owed, so the row is not DONE |
| LSN-014 | Retry weak areas | NOT STARTED | Retry now appears ONLY for a learner with genuinely missed questions in their latest submitted attempt (per-question misses read from the submitted answers; proven by tests and the built-server scenario), and its route already filters to those questions. The human acceptance of the drill itself is still owed |
| LSN-015 | General Listening is section-only (no full mode, no hub) | **IN PROGRESS** | `/app/listening/general` lists published SECTIONS only (packaged and natively authored) and a section opens DIRECTLY into ONE Listening activity — no hub, no four-part exam, no Script/MCQ/Matching cards (G1–G3/G7, smoke 37/37, role/journey scenario 59/59). The human browser pass is EXTERNALLY UNVERIFIED (HTTP + real sessions + real PostgreSQL was performed; jsdom is not browser evidence), so the row is not DONE |
| LSN-016 | General Listening note-taking | **IN PROGRESS** | a section attempt carries the EXISTING Listening note-taking (never the lesson's Xulosangiz), scoped to the attempt; asserted structurally in the journey scenario (J8/J9) and by the built-server smoke. Cross-device persistence is the next checkpoint, so the row is not DONE |
| LSN-017 | General Listening highlight | **IN PROGRESS** | highlight is a narrow, opt-in extension of the ONE canonical text surface (character offsets over the visible text, per learner per attempt, `data-highlight-surface`), proven by H1–H5 + G9 + smoke L5i/L5j. A server-persisted store needs a table and is a separately recorded decision (none added), so the row is not DONE |
| LSN-018 | General Listening vocabulary | **IN PROGRESS** | vocabulary inside a section uses the canonical Dictionary/lexical architecture and the canonical Listening source identity; the spelling-only lookup is answered for a section and refused for a running full exam (M21b, G10, smoke L9/L9b). The owner's frozen dictionary catalog is still external, so meanings are honestly "not checked yet" where no sense exists |
| LSN-019 | MCQ Day architecture (program → day → 5 questions) | NOT STARTED | new schema required |
| LSN-020 | exactly 5 valid MCQs per published Day | NOT STARTED | |
| LSN-021 | 30-day / 150-item corpus support without hard-coding 150 | NOT STARTED | |
| LSN-022 | safe HTML conversion (inert parse, never execute) | **IN PROGRESS** | canonical importer + review screen already exist (`src/lib/import/listening/*`, `ListeningImport.tsx`, `ListeningLegacyImport.tsx`); the V4 activity extraction and full-transcript script exercise still have to land |
| RDG-001 | Reading Lessons | NOT STARTED | |
| RDG-002 | Academic 3-passage full tests | NOT STARTED | academic sets exist (`/app/reading/academic/[setId]`) |
| RDG-003 | Academic review evidence | NOT STARTED | |
| RDG-004 | General Reading passage 1/2/3 | **IN PROGRESS** | `?passage=` selection exists on `/app/reading/general/[setId]` |
| RDG-005 | General FULL | **IN PROGRESS** | same surface |
| RDG-006 | General vocabulary | **IN PROGRESS** | lexical interaction exists in the practice surfaces |
| RDG-007 | question-type selector ("Savol turini tanlang") | **IN PROGRESS** | a type filter exists in the Reading hub tabs; needs the registry-driven control and canonical wording |
| RDG-008 | registry-driven question types | **IN PROGRESS** | `src/lib/content/question-types.ts` is the registry; the UI must read it |
| RDG-009 | question-type passage index | NOT STARTED | |
| RDG-010 | Reading-wide highlight | **IN PROGRESS** | highlight exists in some surfaces; one engine, every Reading area |
| RDG-011 | evidence | NOT STARTED | |
| RDG-012 | short explanation | NOT STARTED | |
| RDG-013 | remove "General Training" from learner navigation | **IN PROGRESS** | the Reading hub tab set no longer contains a General Training tab; the legacy classification/inventory is still owed |
| RDG-014 | direct Retention entry | NOT STARTED | |
| FRZ-001 | Writing unchanged except `/app` | **DONE for the URL move** | typing tests 17/0, presets 9/0, writing-admin 10/0 after the move; no Writing behaviour changed |
| FRZ-002 | Speaking unchanged except `/app` | **DONE for the URL move** | speaking-hub-rebuild 10/0, practice 10/0, canonical identity 4/0 after the move |
| FRZ-003 | unrelated modules unchanged | **DONE for the URL move** | full unit suite 1152 pass / 0 fail |
| SEC-001 | auth preserved | **DONE** | one database-backed gate in `src/app/app/layout.tsx` covers the shell and focus groups; the middleware's coarse prefixes are now derived from the same table as the redirects (no drift); built-server smoke: `/app/*` → `/login?next=…` anonymously, `/api/*` → 401/405 and never redirected, a student session on a staff page gets the redirect instruction and **none** of the page's markup |
| SEC-002 | private assets | **DONE (unchanged)** | private R2/S3 model untouched by this workstream |
| SEC-003 | answer secrecy | **DONE (unchanged)** | MCQ stage model untouched |
| SEC-004 | student-note privacy | **DONE** | `lesson_notes` is keyed `(user_id, lesson_id)` and every read/write filters on the caller's own id; no staff surface references it (N6 walks `src`), and the listening lesson page reaches it only through `readLessonNote(userId, ...)`. Runtime: student 200 on their own note, owner `null` on the same lesson, the text on no other surface |
| PERF-001 | no regression | **IN PROGRESS** | the move adds one cached `getCurrentUser()` parent read and one extra layout frame; measured comparison still owed (§4, §66) |
| QA-001 | full gates | **IN PROGRESS** | unit 1152/0/96, ui 233/0/0, typecheck/lint/build/diff-check green after Phase B; real-PG and `qa:gate` re-run owed after the later phases |
| QA-002 | browser acceptance | **BLOCKED — EXTERNAL** | no real browser is available in this environment; jsdom is never counted. A built-server HTTP smoke of the redirect/gate behaviour was run instead and is reported as such |

## Phase A/B defects found and fixed (not deferrable)

1. **`/api/lessons/[id]` vs `/api/lessons/[lessonId]`** — the merge combined two lines that
   each used a different slug name for the same URL position. `next build` passes; the
   server answers **500** at request time ("You cannot use different slug names for the
   same dynamic path"). Renamed the Content OS route's parameter to `id` (the URL is
   unchanged: `GET /api/lessons/:id`), and `tests/app-namespace.test.ts` now fails if any
   parent path ever uses two slug names again.
2. **Split gate/shell** — the shell layout used to be the gate as well. A focus route must
   not inherit the shell, and there must not be two authorization paths, so the gate moved
   to `src/app/app/layout.tsx` and the shell chrome to the sibling `(shell)/layout.tsx`.
   `getCurrentUser()` is React-`cache()`d, so this is still one query per request.
3. **Fetch mocks keyed on page paths** — three UI tests matched API URLs with page-path
   fragments (`"/progress"`, `"/vocabulary"`); the namespace rewrite made those fragments
   ambiguous, so they now match the real API path. This was a test defect, not a product
   one, and it is listed here because it was found by the gates rather than by review.


## Route-foundation correction (independent GitHub review, 57ef9c9 → this commit)

Two defects were found in the Phase A/B foundation and are closed here.

### Defect 1 — `/app` was not the dashboard

`src/app/app/(shell)/dashboard/page.tsx` meant the canonical Home URL was
`/app/dashboard`, not the approved `/app`. Fixed by making the dashboard the namespace
**index** (`git mv` to `src/app/app/(shell)/page.tsx` — still one implementation), and
turning `/app/dashboard` into an alias:

| URL | behaviour |
| --- | --- |
| `/app` | the dashboard (200, real data) |
| `/dashboard` | 307 → `/app` |
| `/app/dashboard` | 307 → `/app` |
| `/dashboard/<deeper>` | 307 → `/app/<deeper>` (shape kept, query kept) |

Every internal navigation target that meant "Home" was rewritten to `/app` (55 source
files: the shell row, brand/profile/back links, error boundary, coach, grammar, every
staff `redirect()` guard, the auth callbacks, the landing CTA, robots, prefetch
landings). The only file that keeps the literal `/app/dashboard` is the alias table
itself, and `tests/app-namespace.test.ts` fails if anything else does.
`workspaceKey("/app")` is `"dashboard"` **exactly** (a prefix rule for the root would
swallow every module), and the sidebar's Home row is the one row that opts out of prefix
highlighting. The breadcrumb shows nothing at `/app` — never the namespace name.

### Defect 2 — legacy protected-prefix drift

`next.config.mjs` knew 22 historical modules while `src/middleware.ts` knew 16:
`/video-lessons`, `/profile`, `/notifications`, `/reports`, `/support` and `/management`
were redirected but not session-checked. Both now read **one** table,
`src/lib/nav/private-modules.mjs` (dependency-light ESM, imported by the config, the Edge
middleware bundle and the tests; typed by `private-modules.d.mts`), and the test asserts
the parity mechanically instead of restating a subset — so the drift cannot come back.
`robots.ts` derives its private list from the same table.

The coarse check still matters even though `next.config` redirects win for GET: Next does
not apply `redirects()` to non-GET requests, and a module whose rule is ever removed would
otherwise lose its check.


## PHASE C — private Student Notes ("Xulosangiz")

| id | requirement | status | evidence |
| --- | --- | --- | --- |
| NOTE-001 | one shared private note store, keyed by (learner, stable lesson) | **DONE** | `lesson_notes` (migration 0049), UNIQUE `(user_id, lesson_id)`; `lessons.id` is the stable logical lesson, so a new revision keeps the note. `tests/lesson-notes.test.ts` N1 |
| NOTE-002 | readable by that learner only; another learner gets nothing | **DONE** | every service call takes the caller's id and filters on it; N2 (two learners, one lesson, both notes coexist, a third sees `null`); runtime: owner session on the student's lesson → `{"notes":null}` |
| NOTE-003 | teacher/admin/owner ordinary routes cannot read it | **DONE** | no staff surface references the table (N6 walks the real filesystem); the API is learner-scoped, so a staff session only ever sees its own note; runtime: `/app/progress`, `/app/reports`, `/app/notifications`, `/app/profile`, `/app` and the lesson page body contain no other learner's text |
| NOTE-004 | never in progress/search/report/audit/analytics payloads | **DONE** | `lesson_progress.notes` is no longer read (`roadmap.ts`) or written (`state` route) — legacy text was MOVED into the private table; N5 proves the copy-then-guarded-clear backfill; N6/N7 guard the read paths |
| NOTE-005 | upsert + debounced autosave with truthful Saving/Saved/Could-not-save | **DONE** | atomic `insert … on conflict do update`; `LessonNotesPanel` — 900 ms debounce, blur flush, pagehide flush, unmount flush, exit writes with `keepalive`; `tests/ui/lesson-notes-panel.test.tsx` (9 tests) |
| NOTE-010 | autosave correction C1 — the exit flush must send the LATEST text | **DONE** | the exit effect is registered once and reads `latestTextRef`/`acknowledgedTextRef`; it never closes over a render's `text` (the old empty-dependency cleanup sent the initial value). UI test C1 types and unmounts inside the debounce window and asserts the request body is the latest text with `keepalive: true` |
| NOTE-011 | autosave correction C2 — deterministic write ordering, not abort-based cancellation | **DONE** | ONE serialized pipeline per panel: `inFlightRef` latch + ONE coalesced `pendingRef`; a newer edit never starts a second write, and after each settle the loop sends the latest pending value. `useScopedRequest` is deliberately NOT used (its abort-previous-request behaviour proves only that the client stopped waiting, never that the server stopped writing). Tests C2–C4 assert the exact request sequence (`A`, then `B`; `A`, then `C` — B is superseded, not queued) |
| NOTE-012 | ordering guarantee scope, stated precisely | **DONE** | documented in the component, the server suite and here: the UNIQUE index proves ONE ROW per (user, lesson); "latest edit wins" is proven by the client pipeline **within one mounted panel session**. Cross-tab / cross-device last-writer ordering is NOT implemented (no optimistic-concurrency token on the row) and is not claimed |
| NOTE-006 | never localStorage-only | **DONE** | no web-storage API anywhere in the panel; the server table is the only store (N7 + the UI suite assert it) |
| NOTE-007 | bounded text, no HTML, refusal instead of truncation | **DONE** | 4,000-character bound enforced in the service, the API, the CHECK constraints and the UI; N3 |
| NOTE-008 | only on a lesson the learner can open | **DONE** | the publication gate lives in the service (`lessonOpenForNotes`), so every caller inherits it; N4 (draft, scheduled, unknown) |
| NOTE-009 | migration safety | **DONE** | 0049 registered in `ALLOWED_PENDING` + hash-pinned; fresh DB 50/50 (`qa:pg`); accepted-COS upgrade path simulated on real PostgreSQL: migrator applied ONLY 0049, legacy text moved, progress column cleared, 50 journal rows |

Not yet built (Phase C continues): the Listening **Lessons** three-tab surface (Description / Teacher Notes / Xulosangiz) that reuses this panel, and the remaining Listening/Reading V4 scope.


## Listening → Lessons (PHASE C, after NOTE-010…012)

> **SEMANTIC CORRECTION (owner directive, 2026-10-06).** The Listening → Lessons
> contract recorded below as LSN-017 was **reversed**: a "listening lesson" is not derived
> from an audio block, an audio reference or an attached audio media item. A Listening
> Lesson is a lesson **ABOUT listening**, classified by its authored learning area
> (`lessons.learning_area`, migration 0050) — a video-only MCQ-strategy lesson, a
> text-heavy note-taking lesson, an audio lesson and a mixed-block lesson are all
> legitimate Listening lessons, and an audio lesson about Reading is not.
>
> | contract | evidence |
> | --- | --- |
> | explicit, authored, generic area (listening \| reading \| writing \| speaking \| grammar \| vocabulary \| general) on the ONE `lessons` system | `src/lib/content/learning-areas.ts`, `drizzle/0050_lesson_learning_area.sql`, `docs/MIGRATION-APPROVAL-0050.md` |
> | media type never classifies; an unspecified lesson stays unspecified | `tests/listening-lessons.test.ts` L1–L4, L15 |
> | the area is a WHERE clause, applied BEFORE any bound (the previous reader took the newest 60 lessons and classified afterwards) | `src/lib/content/lesson-library.ts`, L13–L14 (65 newer reading lessons still return both listening lessons), same pre-filter removed from the staff reader |
> | lesson-level Teacher Notes, media-independent, in the pinned revision, lesson-level wins over the media fallback | L5–L8, L16; `tests/content-preview.test.ts` PV7 (and a `{ blocks }`-only pre-0050 revision stays readable, `source: "lesson_row"`) |
> | a teacher gets exactly the authoring capability, never the admin workspace | L10–L12; `scripts/verify-lesson-learning-area.mjs` (built server: teacher drafts → 201, teacher publishes → 403 `publish_forbidden`, owner publishes → 200, teacher workspace → redirect) |
> | the dead link is fixed with a staff-safe desk on the SAME authoring services | `/app/listening/lessons/author` → `POST /api/admin/content/drafts` → `saveContentDraft` → the lesson author → `saveLessonStructure` + `pinVersion` |
> | built-server acceptance, all seven required fixtures, fixtures deleted and cleanup verified | `scripts/verify-lesson-learning-area.mjs` — **43/43** (the two desk checks moved to what the browser actually receives: the role flag is server-rendered, the editor controls are searched in the served client bundle — see the authoring-safety section below) |
> | no per-skill lesson table was invented | the extra guard in `tests/listening-lessons.test.ts`; `lessons` remains the single system |
>
> **Accepted.** The correction was proven end-to-end (see "Lesson authoring safety" below) and
> the owner accepted it on 2026-10-06, so LSN-001, LSN-003 and LSN-017 are **DONE**; LSN-002,
> LSN-004, LSN-018, LSN-019 and LSN-024 were already DONE. The acceptance rests on the frozen-tree
> gate (unit 1309 tests / 1213 pass / 0 fail, ui 247/247, real-PG 1309 / 1305 pass / 0 fail,
> `qa:pg` 51/51, typecheck 0, lint 0, build 0, diff-check 0) plus the built-server human scenarios
> (43/43 and 62/62) and the desk's own UI case (5/5) — never on unit tests alone.

| id | requirement | status | evidence |
| --- | --- | --- | --- |
| LSN-017 | **A Listening lesson is explicitly classified by canonical learning area, independent of media type** (requirement REPLACED by the owner: the derived-from-media contract was reversed) | **DONE** | `lessons.learning_area` is authored, stable and generic (`listening | reading | writing | speaking | grammar | vocabulary | general`); the learner library filters `WHERE learning_area = <area>` BEFORE any bound, and never infers from a title, a slug, an audio block, attached media or a course. Video-only, audio-only and text-heavy Listening lessons are all legitimate (L1–L4, L13–L14); unspecified stays unspecified (L4, L15). Proven by the semantic-correction tests, the 0050 migration proofs (fresh + accepted-state upgrade, 25/25 + 3/3), the built-server smoke 43/43, the authoring-safety scenario 62/62 and the full gate on the frozen tree; the owner accepted the corrected contract on 2026-10-06 |
| LSN-018 | an empty catalogue stays empty | **DONE** | no seed and no placeholder card; the learner gets a truthful empty state. The staff CTA now points at the staff-safe lesson authoring desk `/app/listening/lessons/author` (it previously pointed a teacher at the administrator-only `/app/admin/content/workspace`). Runtime: a student sees the empty state WITHOUT the link, staff see it WITH the link |
| LSN-019 | the lesson body comes first, then exactly three tabs | **DONE** | `ListeningLessonBody` renders the authored typed blocks before the tab bar; the tabs are Description / Teacher notes / Xulosangiz, in that order (LL4 + runtime) |
| LSN-020 | tabs are derived from the route, so a reload keeps the section | **DONE** | the tab lives in `?tab=` and is read from `searchParams`; the tab links carry it; an unknown value falls back to Description (LL4 + runtime, all three tabs) |
| LSN-021 | answer keys stay server-side in a listening body | **DONE** | quiz blocks answer through the existing `POST /api/lessons/blocks/:blockId/answer`; `loadLessonForLearner` hands over no key and no explanation until the learner has answered (LL2). `blockId` was added to the resolved block — the learner's own row reference, which carries no answer |
| LSN-022 | media is served privately or linked to the canonical media surface | **DONE** | block media goes through the authorizing `/api/resources/<objectKey>` route; an attached provider item links to `/app/video-lessons/[id]` instead of a second player. Runtime: with no authorized media origin configured the page shows that link, not an empty player |
| LSN-023 | page-level `notFound()` under the streaming shell | **documented, not a claim** | the page calls `notFound()` for unknown / non-live / non-listening lessons; because the shell streams, the response is 200 carrying `NEXT_HTTP_ERROR_FALLBACK;404` and the client renders the not-found boundary. This is the app's existing behaviour on every `[id]` route (`/app/reading/attempts/not-a-uuid` behaves the same) — no HTTP 404 is claimed anywhere |

## Academic Listening — catalogue and hubs (owner directive, 2026-10-06)

> **What exists now.** `/app/listening/academic` is the Learners Area catalogue of the centre's
> published Academic Listening tests, and `/app/listening/academic/<testId>` is the TEST HUB for
> one of them. Both read the ONE canonical Listening layer (`listening_tests` +
> `listening_packages`); neither one is a second content system, a second design, or a
> hard-coded list. The activities on a hub come from `src/lib/listening/activities.ts`, fed by
> the test's authored facts and by what is true about the learner looking at it — so two
> genuinely different tests show two genuinely different hubs.
>
> | contract | evidence |
> | --- | --- |
> | the catalogue lists PUBLISHED canonical academic tests only; a draft never appears to a learner | `academicListeningCards` (`src/lib/data/listening-academic.ts`) with `liveWhere`; AL1/AL3, built-server C2/C3 |
> | the collection is a WHERE clause, never a post-filter that could hide a real test behind newer unrelated rows; the read is bounded | `academicCollection` + `ACADEMIC_LISTENING_PAGE_MAX` (60); AL2 (a smaller limit is honoured, a huge one is capped) |
> | membership is decided once: `academic`, `question_types` and `mcq` are in; `essential` and `general` are not; a row with no collection means academic (the rule the existing library already applies) | `isAcademicCollection` + the SQL predicate; AL1 (`essential` excluded), AL6 (`essential` is not a hub), built-server C4/H5c |
> | ordering is the AUTHORED sequence, and it is stated honestly: `listening_tests` has NO position/number column, so nothing is invented and NO migration was added | `orderBy(created_at, source_ref)` + the comment in the reader; AL1 (a row authored last with a textually-first reference stays last), built-server C5 |
> | a display title is never parsed and nothing is hard-coded | AL1 (`orderKey` is the authored reference), built-server C5b (no fixture reference in the page) |
> | the hub's cards answer "does THIS test genuinely support THIS activity" from authored facts | `packageActivities(payload, learner)`; AL3/AL4 (fixture A: exam/script/mcq/matching/completion/vocab; fixture B: exam/completion only) |
> | a card is never offered for something the route cannot deliver — the graded drills need the kind the source authored, Script Completion needs authored blanks across the FULL transcript, and vocab/recall/keywords need their content | `activityFacts` + descriptors; AL3/AL4; built-server H1b/H2b (the two fixtures' hubs differ, exactly as their sources do) |
> | Matching is never filed as MCQ, and no card is faked, forced or disabled to fill a grid | `isMcqQuestion` (options AND not matching/completion); built-server H2d (the completion-only test has no MCQ, Matching, Script or Vocabulary card) |
> | Review exists only after a submitted attempt, and Retry Weak Areas only for genuinely missed questions | `listeningLearnerFacts` (misses read from that attempt's answers); AL5/AL10; built-server H1d/H1e before the attempt and H3/H3b after it |
> | every learner surface hands the registry the learner's own facts — a hub that forgets them would silently hide Review and Retry | the AL9 source guard over `src/**` (proved non-vacuous), the fix that made the existing `/app/listening/tests/[id]` hub use the same helper, and `testActivities` for the one learner-free caller (the staff import preview, asserted to be its only caller) |
> | an answer key never reaches a learner surface | built-server H4/H4b (`QASECRETKEY-MUSEUM` appears nowhere in the catalogue or either hub) |
> | a draft test, a non-academic test and a malformed id are one answer — not found, leaking nothing | `isUuid` + `isAcademicCollection` before any hub read; AL6/AL7; built-server H5/H5b/H5c/H5d |
> | the activity routes are the EXISTING ones (timer/audio/nav/flag/notes/autosave exam, staged MCQ engine, review, transcript study, graded drills) | `activityPath` points at `/app/listening/tests/:id/…`; nothing was re-implemented |
> | fixtures A and B are created, proved different, and DELETED with the removal asserted | `tests/listening-academic-hub.test.ts` AL8; built-server Z1/Z2/Z3 (residue of the whole fixture prefix checked, and a re-run clears earlier residue first) |
> | no second CMS, test table, version table, upload system or quiz registry | `tests/listening-canonical-import.test.ts`, `tests/listening-regression-contract.test.ts` guards; the module reuses `fullListeningDetail`/`fullListeningProgress`/`listeningPracticeProgress` and the existing registry |
> | no new migration | 0050 is still the newest; 51 shipped migrations (gate: `migrations ok: 51 / 51`) |
> | the human scenario was performed on the BUILT server against the isolated QA2 database | `scripts/verify-listening-academic.mjs` — **39/39**, twice in a row (catalogue truth, two different hubs, learner gating, key secrecy, refusals, cleanup) |
>
> Deployment note (recorded because it cost a deploy): a commit must be authored with the
> repository's configured, GitHub-linked identity. A commit from an unlinked address is refused by
> the platform with `GitHub couldn't verify an account for the commit` and nothing is deployed, so
> the release evidence never comes from such a commit.
>
> Gates on the frozen tree (`cb47cd3`): unit **1309 tests / 1213 pass / 0 fail / 96 skipped** (owner assets:
> the Listening source ZIP and the frozen dictionary catalogue), ui **247/247/0/0**, real-PG **1309 / 1305 pass /
> 0 fail / 4 skipped** (the same two owner assets), `qa:pg` migrations 51/51 + owner/student fixtures,
> `typecheck` 0, `lint` 0, `build` 0, `git diff --check` 0.


## Academic Listening — classification and pagination correction (V4 owner directive, 2026-10-07)

> **What changed and why.** Two defects were confirmed in the shipped product and corrected at the
> root, without deleting content, without relabelling any canonical identity, and without a
> migration:
>
> 1. **Misclassification.** The catalogue membership test was
>    `coalesce(payload->>'collection','academic') in ('academic','question_types','mcq')`, and the
>    library's tab logic folded `question_types`/`mcq` into the academic tab as well. A dedicated
>    MCQ training package and question-type practice therefore appeared to a learner as Academic
>    full tests. The owner's rule is that they do not.
> 2. **A 60-test cap.** The catalogue read was one clamped `.limit(60)` with no page argument, so
>    a 61st published test was unreachable no matter what the learner did.
>
> **The one classifier.** `src/lib/listening/product.ts` holds ONE decision table, expressed twice
> (a TypeScript function for a loaded payload and a SQL expression for the catalogue read) and
> driven by the SAME matrix of cases in test A11, which fails if the two expressions ever
> disagree. It reads authored facts in a fixed order and never a title:
> the content version's type (`full_test` → academic, `section` → general) → the package's authored
> `collection` (`academic`/`general`/`mcq`/`question_types`/`essential`) → a package with no
> collection ONLY when its structure proves a formal full test (4 parts and 40 questions) →
> otherwise `unclassified`, offered nowhere.
>
> | contract | evidence |
> | --- | --- |
> | only a formal Academic full test is in `/app/listening/academic`; a dedicated MCQ package and question-type practice are not, and their `collection` in the database is untouched | `academicProductSql` as the catalogue WHERE clause + `isAcademicFullTest` at the hub guard; A1–A6, A11; real-PG acceptance `scripts/verify-listening-classification.ts` **21/21** (70 + 5 + 3 + 4 + 2 dataset, `mcq`=5 and `question_types`=3 still in the rows) |
> | MCQ *inside* an academic test still powers that test's own MCQ Mastery hub — classification is not a question-type whitelist | A9 (a formal test containing MCQ keeps its MCQ activity; the dedicated MCQ package has no hub) |
> | a legacy row is never guessed into the catalogue: no collection AND no provable 4×40 structure stays `unclassified` and is **reported for owner review** instead | A1 (the unprovable fixture is excluded), real-PG acceptance (the unprovable row is `unclassified`), and the read-only triage tool `scripts/listening-classification-report.ts` (run on real PostgreSQL: the academic row is listed, the unprovable row is printed under `REVIEW REQUIRED` with its shape and attempts; nothing is written) |
> | the same rule is applied on every learner surface that used to collapse the two collections — the library's tab logic no longer presents an MCQ package as academic | `categoryOf` in `FullListeningLibrary.tsx`; new UI case (the academic tab counts 1, the MCQ package appears only under its own tab, nothing deleted or relabelled) |
> | the catalogue is paged, not capped: filter BEFORE the bound, a TOTAL order (`created_at`, `source_ref`, `id`), 24 per page, `?page=` clamped, Previous/Next, the total stated | `ACADEMIC_LISTENING_PAGE_SIZE = 24`, `ACADEMIC_LISTENING_PAGE_SIZE`-bounded `.limit().offset()`; A7 (70 rows: 3 pages, no repeat, no disappearance), A8 (catalogue membership == hub membership) |
> | a learner reaching the end can PROVE the cap is gone through the rendered page, not only in a query | built-server smoke `P1–P11`: 63 published tests → page 1/2/3 = 24/24/15, every one reachable exactly once, stable across requests, `?page=99` honest and empty, `?page=-3` clamped — **50/50 checks** |
> | no whole-catalogue download, no test number fabricated from a title, no ordering migration | one bounded page per request; A7 asserts the bound; the reader's comment records that a persisted ordering column is a separate decision (still none: 0050 is the newest migration, journal 51/51) |
> | a NEW revision filed as `listening:full_test` cannot be published as a complete IELTS test unless it really has 4 parts / 40 questions — and the refusal tells the author what to do instead (file it as a Listening section, which publishes normally) | `fullTestStructureProblem` + `publicationIssues`; AU13 (a 5-question drill is refused with the real count, the row stays a draft, the same material publishes as a `listening:section`) |
> | historical content is never re-validated or rewritten: only the moment of publication is judged, and existing live tests keep their state | the check runs for `to = published | scheduled` on the revision being published; AU7/AU9/AU12 fixtures publish formal tests |
> | accept-dataset behaviour on REAL PostgreSQL, including history | `scripts/verify-listening-classification.ts` **21/21**: 70 academic listed and all reachable in 3 pages, first page bounded at 24, MCQ/question-type/draft/archived excluded, an archived test is `archived` (not deleted) while the learner's attempt on it is still readable |
> | fixtures are deleted and the removal is proven | the verifier cleans by prefix in FK order and asserts 0 rows + an empty catalogue; the built-server smoke asserts Z1/Z2/Z3 and re-runs clean (twice, 50/50) |
>
> **A second, pre-existing defect was found while proving the first one.** The publication
> validator `publicationIssues` called `author.setPublication` to *ask* whether a row could hold a
> publication state — but that call WRITES the row. A refused publication therefore left the
> content row live (in the worst case: learner-visible content whose revision was still a draft).
> The probe is removed; the question is now answered by the real write, which refuses before
> writing anything (`unsupported_schedule`), so asking can no longer publish. AU13 (a refused
> publish leaves the row a draft) and AU13b (a refused schedule on a type with no publish moment
> leaves the row a draft) both assert the row is untouched.
>
> Gates on this tree: unit **1316 tests / 1220 pass / 0 fail / 96 skipped**, ui **248/248/0/0**,
> real-PG **1316 / 1312 pass / 0 fail / 4 skipped**, `qa:pg` migrations 51/51 + owner/student
> fixtures, `typecheck` 0, `lint` 0, `build` 0, `git diff --check` 0, `npm run qa:gate` **GATE PASS**
> (logs `/tmp/qa-gate-cp1-final`). The 96/4 skips are the same owner assets as before (the Listening
> source ZIP and the frozen dictionary catalogue) — named, never counted as passes.
>
> **Not claimed.** General Listening (`/app/listening/general`, its catalogue and its one-section
> experience) is the next checkpoint; the MCQ day programme is a separate workstream that is not
> started; no route for dedicated MCQ packages is invented here — until its own surface exists they
> remain reachable in the library under their own collection tabs, and the owner-review tool lists
> every row the catalogue deliberately does not classify.


## General Listening — the standalone section catalogue and its ONE activity (V4 owner directive, 2026-10-07)

> **The product this implements.** `/app/listening/general` lists the centre's published standalone
> SECTIONS, and a section opens DIRECTLY into the familiar Listening interface — audio, questions,
> question navigation, note-taking, highlight, vocabulary, submit. There is no per-section activity
> hub, no four-part General exam, no separate Script / MCQ / Matching cards: a section's
> multiple-choice questions are answered inside that one attempt. Nothing is inferred from a title
> or from media; membership comes from the same classifier the Academic catalogue uses.
>
> | contract | evidence |
> | --- | --- |
> | the catalogue lists PUBLISHED SECTIONS only — a package-backed one and one authored through the CMS with NO package at all — and lists no academic full test, no dedicated MCQ package, no question-type practice, no Essential recording, no draft and no archived item | `generalListeningCards` reads `generalProductSql` (filter BEFORE the bound) over a LEFT JOIN so a package-less section is not hidden; `tests/listening-general-library.test.ts` **G1 8/8** (G1–G3, G7); built-server `L1`/`L1c`/`L2`/`L2b`/`L2c` |
> | the read is bounded, paged and stably ordered, a nonsense page argument clamps to the first page, and every section is reachable exactly once | `GENERAL_LISTENING_PAGE_SIZE = 24`; `G4` (70 sections: 3 pages, no repeat, no disappearance); smoke `L4`–`L4e` (24 + 7 across two pages, identical order on a repeat request) |
> | a card states the section's authored identity (section number from the revision, the real question count, the authored duration only when one exists) and the LEARNER'S OWN truth — nothing before they open it, "In progress" for their own open attempt, their own last result after submitting, never another learner's | `G5`, `G6`; smoke `L3b`–`L3f`, `L7`; human journey `J2`–`J4`, `J17`, `J18` |
> | opening a section is a SINGLE Listening activity: one attempt, the audio, the questions, question navigation, note-taking; the four-part exam framing is ABSENT (asserted structurally, never by searching for words that also exist in the dictionary payload) | `SectionListeningActivity` → `NativeListeningExam` with `sectionMode`; markers `data-listening-attempt-mode="section"` / no `data-listening-exam-sections`; `G7`; smoke `L5`–`L5h`; human `student6`–`student10` |
> | a FINISHED section shows its own result. **Defect closed here:** a section that carries a canonical package was redirected to `/app/listening/tests/:id/2` — the four-part Academic result screen — while a natively authored one showed its own result, so the presentation depended on HOW the centre authored it | `if (!section && pkg)` in the attempt page; smoke `L8`/`L8b`/`L8c` (submit → the section's own page, never a redirect); human `J13`–`J16` |
> | notes are the EXISTING Listening attempt note-taking, scoped to the attempt — never the lesson's Xulosangiz | the attempt's own `listening-exam-notes` control; human `J8`, `J9` (asserted on the lesson-notes panel marker, so the dictionary payload cannot fake the result) |
> | highlight is a NARROW extension of the ONE canonical text surface: opt-in (every other surface is byte-for-byte unchanged), character offsets over the VISIBLE text, stored per learner per attempt, and it can never read an answer or a key | `ClickableText` props `highlights`/`onHighlightRange`/`onRemoveHighlight` + `data-highlight-surface`; `tests/ui/listening-section-highlight.test.tsx` H1–H5; `G9`; smoke `L5i`/`L5j` |
> | vocabulary is the ONE canonical Dictionary/lexical architecture — no new tables, no duplicate lexemes, no pre-submission answer material. The section asks the canonical lexical API with the canonical Listening source identity, and its lookup is ANSWERED while the learner is working in the section, while a RUNNING Academic full exam stays sealed | `lexicalAssistanceAllowed("SECTION_PRACTICE", …)` in `src/lib/listening/lexical-policy.ts` + `modeForListeningProduct` driven by `listeningProductOf` (the same classifier the catalogues use) → `resolveListeningOccurrence` and `/api/vocabulary/meaning`; smoke `L9`/`L9b`; `M21b` (21/21) proves both directions on real PostgreSQL; `G10` proves the reader agrees with the classifier for every case |
> | the graded exam screen still holds NO lexical knowledge: the section composes the canonical surface and INJECTS it, so the protection test that seals the full exam is intact rather than relaxed | `M21` unchanged and passing; `G9` now also asserts `NativeListeningExam.tsx` contains no vocabulary component and that the section wrapper composes the canonical one |
> | a section authored through the CMS persists the learner's answers in progress. **Defect closed here:** the draft route required a canonical package, so a natively authored section kept answers only in the learner's browser and would have been refused server-side | `PUT /api/listening/attempts/:id/draft` falls back to the canonical question rows when no package exists and bounds the position by the authored length only when one is stated; human `owner6`, `owner7` (stored on the server), `owner7b`, `J6`, `J7`, `J7b` |
> | authoring goes through the one Content OS: the owner authors a `listening:section` and publishes it; a TEACHER cannot author a Listening section at all; and a five-question item filed as `listening:full_test` cannot be published as a formal IELTS test — the refusal states the real count and tells the author to file it as a section, and nothing is written | human `owner1`–`owner5`, `owner8`, `teacher3`, `teacher4`, `admin1`–`admin5` (422 `incomplete_full_test`, the row still a draft, absent from both catalogues) |
> | security at the boundaries: anonymous visitors are sent to sign in and refused by the API (401) without leaking anything; a learner cannot open another account's attempt; no key or hidden explanation reaches the catalogue or the attempt; a draft is invisible to learners and to staff alike | human `anon1`–`anon5`, `student5`, `student9`, `student11`, `teacher2` |
> | fixtures are deleted and the removal is PROVEN | `G8` + `G10` self-cleanup; smoke `Z1`–`Z3`; human `Z1`–`Z5` (rows, revisions, the scenario's own teacher/admin identities, both catalogues clean) |
>
> **Two process lessons, recorded so they are not repeated.** (1) A whole-page regex is not evidence:
> the attempt page carries the entire dictionary, where "Full Exam" appears three times, so the
> structural markers above are the assertion. (2) A test that seeds product-visible rows MUST delete
> them: the new classifier test initially left `collection: general/academic` fixtures in QA2, which
> silently inflated the catalogue totals the smoke asserts. The test now removes its rows in a
> `finally` block and asserts zero residue — and the residue it had already written was deleted and
> re-proved (catalogue totals back to the fixtures' own counts).
>
> Gates on this tree: unit **1325 tests / 1228 pass / 0 fail / 97 skipped**, ui **252/252/0/0**,
> real-PG **1325 / 1321 pass / 0 fail / 4 skipped**, `typecheck` 0, `lint` 0, `build` 0,
> `git diff --check` 0, `npm run qa:gate` **GATE PASS** (logs `/tmp/qa-out-cp2-gate2`). Checkpoint 1
> was RE-PROVED after the classifier reorder: classification dataset **21/21**, Academic
> built-server **50/50**, General built-server **37/37**, role/journey scenario **59/59**.
>
> **Not claimed / owner actions.** (1) The §25 human scenario was performed over real HTTP against
> the built server with real PostgreSQL and real sessions — NOT in a browser: drawing a text
> selection with a pointer and the popover's paint are therefore **EXTERNALLY UNVERIFIED** (the DOM
> test covers the range logic and is not browser evidence). (2) A highlight that survives a
> different device needs a persisted store — that is a TABLE, i.e. a separately recorded decision,
> and none was added (journal is still 51/51; the store is per learner per attempt in the browser).
> (3) A full test authored natively as `listening:full_test` (no canonical package) has no hub to
> open, so the Academic catalogue does not offer it — an authoring-path gap recorded for OWNER
> REVIEW, asserted in both directions by `A11`, never patched by inventing a hub. (4) The Dictionary
> catalog remains the owner's frozen asset (skips), and the dedicated 30-day MCQ corpus is still the
> owner's. (5) Notes/highlight persistence across devices and the per-activity note scoping are the
> next checkpoint; the MCQ day programme is a separate workstream that is NOT started.


## The module library states each card's real identity (same defect, second place — 2026-10-07)

> **Why this section exists.** The owner's rule is that a card must never STATE something untrue
> about its content. The Academic catalogue was corrected first; the SAME mistake lived in a
> second place — `/app/listening`, the module library — and was found while writing the test that
> was supposed to cover it.
>
> | what was wrong | what it is now |
> | --- | --- |
> | `fullListeningCards` filed every package as `coalesce(payload->>'collection', 'academic')`, so a package that proves nothing (no collection, no 4-part / 40-question structure) was presented under the Academic tab | the tab comes from the ONE classifier (`collectionTabSql` beside the ONE decision table in `parse/src/lib/listening/product.ts`); a row that proves nothing lands in an honest `uncatalogued` tab, rendered only when such a card exists |
> | `legacyListeningCards` hard-coded `collection: 'academic'` and `40 questions` for EVERY row without a package, so a Listening SECTION authored through the CMS appeared as an Academic full test and a two-question item claimed forty | the row is filed by the revision the CMS authored (`listening:full_test` → academic, `listening:section` → general, nothing → `uncatalogued`) and the card states its REAL question count |
> | the attempt flags on those cards never worked: the subquery fragments interpolated a bare column, which the database resolves INSIDE the subquery (`a.test_id = a.id`, i.e. never true), so a learner with a finished attempt on a package-less test was never shown as having started it | the references are qualified (`sql.raw('"listening_tests"."id"')`). Measured on a real engine before and after: the unqualified form returns 0, the qualified form 1; test L4 asserts started/completed per learner AND that another account's progress is never adopted |
> | `null->>'collection'` is invalid SQL on the package-less path | the payload side of the classifier is `null::jsonb` |
>
> **A method lesson, recorded so it is not repeated.** Counting marker substrings is not evidence
> of what a learner sees: Next.js also serializes the same props into the RSC flight payload, so
> `data-listening-general-back` appeared twice for ONE rendered link. The navigation contract is
> therefore asserted on RENDERED ANCHORS — `<a ... data-listening-general-back="true" ...
> href="/app/listening">` — one way back on the catalogue, and no second breadcrumb inside the
> attempt. The first version of the check failed on exactly that artifact and was fixed by
> measuring the page, not by relaxing the assertion.
>
> **Evidence.** NEW `tests/listening-library-tabs.test.ts` L1–L5 (the mapping; "a package that
> proves nothing is NOT academic"; a package-less row filed by its authored revision; the real
> counts 2/1/0; the attempt flags per learner; and the removal of its own fixtures with residue
> proven zero). Built server on real PostgreSQL: General smoke **40/40** (+L0/L0b navigation,
> +L5h2), role/journey scenario **59/59**, Academic smoke **50/50**, listening unit **104/104**,
> ui **252/252** (two fixtures updated to state the collection they represent — the assertions
> were NOT weakened). Full gate on this tree: unit **1327 / 1230 pass / 0 fail / 97 skipped**,
> ui **252/252/0/0**, real-PG **1327 / 1323 pass / 0 fail / 4 skipped**, typecheck/lint/build/
> diff-check 0, `npm run qa:gate` **GATE PASS** (logs `/tmp/qa-out-cp2-gate3`).
>
> **Resolved by this correction** (the earlier owner-review note about the module library's
> `collection: 'academic'` fallback is CLOSED — nothing was deleted or relabelled; the canonical
> `collection` in the database is untouched and the tab is derived from it). Still an OWNER-REVIEW
> item and unchanged here: a full test authored natively as `listening:full_test` has no canonical
> package, so it has no hub to open and the Academic catalogue does not offer it.


## Lesson authoring safety (owner directive, 2026-10-06 — after the semantic correction)

> **The defect this closes.** The staff authoring desk hydrated itself from the LESSON LIST:
> selecting a lesson filled in `title`, `slug` and `sourceRef` and left Description, Teacher
> Notes, estimated minutes and EVERY block empty. Pressing Save then wrote that blank lesson
> over real content — data loss by design, for the person the centre asks to write lessons.
>
> Two more defects sat behind it: a generic `POST /api/admin/content/drafts` accepted every
> registered `module:contentType` from anyone who passed `isStaff()` (so a teacher held the
> whole content bank while the desk showed only lesson controls), and editing a live lesson
> had no revision model — a "draft save" aimed at the published revision would have rewritten
> what students were reading.
>
> | contract | evidence |
> | --- | --- |
> | selecting a lesson loads its EDITABLE, bounded staff projection — every field, every block in order, with media metadata and the quiz key — never the learner HTML, never a title guess, never five unrelated APIs | `GET /api/admin/content/lessons/:id/edit` → `src/lib/content/lesson-edit.ts` (`loadLessonEditModel`); `tests/lesson-authoring-revision.test.ts` E1–E4; built-server H |
> | the LIST stays a list: no blocks in the library query, DETAIL is its own request | E5 (source guard on the staff reader + the desk's GET), built-server H |
> | changing ONE field keeps everything else, block rows included | E6, built-server S (title, slug, reference, unit, area, description, minutes and every block compared field by field) |
> | a published revision is immutable; editing a live lesson starts a DRAFT that copies it | `startLessonRevision` (`POST /api/admin/content/lessons/:id/revision`, idempotent); R1–R2, built-server R (v1 byte-for-byte unchanged, same `sourceRef`, same lesson id) |
> | students keep reading the published revision while a draft is edited, and the live row is not touched | R3, R6, built-server S (learner page still serves v1; the row only moves on publication) |
> | publication is what reaches students; the superseded revision stays readable | `publishContentVersion` materializes the row in the same transaction; R4, R7, built-server P |
> | saving continues the SAME editable draft instead of piling up v3, v4, v5 | `pinVersion({ updateVersionId })` — honoured only for the newest, still-editable draft; S (three saves → exactly two revisions) |
> | ONE explicit capability decision: a teacher authors `lesson:lesson` (plus the three the repository already proves), an administrator/owner the registered set, a student nothing | `src/lib/content/authoring-capabilities.ts` + `authoring-access.ts`; A1–A7; built-server C (teacher 403 on `mock:full_mock` and `writing:prompt`, capability keys reported per role) |
> | every failure is a sentence attached to a field — no stack trace, no SQL, no internal code, no file name | the lesson payload's own messages + the `authoringIssues` dictionary; N4, built-server E |
> | no new migration: hydration, authorization and revisioning needed no column | N1 (0050 is still the newest; 51 shipped migrations) |
> | Xulosangiz is untouched by revisioning: never versioned, never visible to staff, survives v1 → v2 | R5, built-server X |
> | the human scenario (§36) performed on the BUILT server: open an existing lesson, see exactly what is inside it, change ONE thing, save, and be confident nothing else was erased | `scripts/verify-lesson-authoring-safety.mjs` — **62/62**, fixtures deleted and cleanup verified |

| id | requirement | status | evidence |
| --- | --- | --- | --- |
| LSN-024 | **Safe lesson authoring**: an author opens an existing lesson, sees its whole editable content, changes one thing and saves it without erasing anything; a live lesson is revised, never overwritten | **DONE** | `tests/lesson-authoring-revision.test.ts` E1–E6, R1–R7, A1–A7, N1–N4 (24 tests, real PostgreSQL); built-server human scenario `scripts/verify-lesson-authoring-safety.mjs` **62/62** (hydration, revision, single-field save, publication, Xulosangiz, capability boundary, honest errors, cleanup verified); the earlier acceptance re-run at **43/43**. Gates on this tree: `tsc` 0 · lint clean · build 120/120 · `npm test` 1303 tests / 0 fail · `test:ui` 242/242 · `qa:pg` 51/51 · migration proofs 25/25 + 3/3 unchanged |
| LSN-025 | **A draft revision may not touch published content** (the §9 data-safety defect: a draft save rewrote the live row and DELETE+INSERTed its questions, destroying historical per-question review through the `listening_answers` cascade) | **IMPLEMENTED — awaiting the full gate on this tree** | `tests/listening-revision-safety.test.ts` R1–R7 (real PostgreSQL, residue asserted 0) + the updated AU3 + J1–J5; focused suites 40/40 and the Listening suites 112/112 (2 by-design skips); fresh migration 52/52; accepted-state upgrade rehearsal `scripts/verify-listening-revision-migration.mjs` **10/10**; typecheck 0, lint 0. Remaining before DONE: the full gate (`npm test`/`test:ui`/`qa:gate`) and the built-server scenario on this tree |

## Data safety — a draft revision may not touch published content (V4 owner directive §9–§11, §10, §41/G8 — 2026-10-07)

> **The defect, proven before it was fixed.** `saveContentDraft` for `listening:full_test` /
> `listening:section` called `persistListening`, which projected every save straight into the
> canonical row: it UPDATED `listening_tests` (title, audio, transcript) and then
> `DELETE`d + re-`INSERT`ed the item's `listening_questions`. Because
> `listening_answers.question_id` is `ON DELETE CASCADE`, editing a PUBLISHED item destroyed the
> per-question review of every attempt ever made on it, and a learner who was mid-attempt resumed
> into a different question set (the draft's) the next time an answer was saved. Publishing wrote
> no question rows at all — it only flipped visibility — so the author's edits reached learners by
> way of the destructive path or not at all. `saveContentDraft` already refused to rewrite a
> published REVISION (`published_is_immutable`); it never refused to rewrite what learners were
> reading. The binding machinery (`listening_attempts.content_version_id`, `attempt-binding.ts`)
> already existed — the content path simply did not use it.
>
> | contract | evidence |
> | --- | --- |
> | a draft save writes NO canonical question rows and leaves the live row alone; the authored content lives in the revision snapshot, which is what preview reads | `persistListening` (`src/lib/content/authors.ts`); `tests/listening-revision-safety.test.ts` R1 (title, state and question ids unchanged after a v2 save); `tests/content-authoring-publication.test.ts` AU3 (a draft writes zero canonical rows, the snapshot carries the canonical type id) |
> | the live set is materialized at PUBLICATION and nowhere else | `materializeListeningRevision` + both listening authors' `setPublication`; R2 (a draft has no rows and is invisible), R3, R6 |
> | publishing a revision never deletes another revision's rows, so historical answers keep pointing at real questions | materialization replaces only rows stamped with ITS OWN version id; R3 (v1's rows are still there, v2's rows are NEW ids), R7 (no orphaned answer) |
> | an in-progress attempt keeps the questions it started with, a finished attempt keeps its score, and a NEW attempt gets the published revision | R4, R5, R6 (a third learner is used for the new-attempt case because `start` correctly RESUMES an open attempt for the same learner) |
> | the catalogue states the LIVE set's size — never the sum of every revision's rows | `listeningQuestionCountForLiveTest`; R2 (`2`) and R6 (`2` after both sets exist) |
> | an item whose canonical set came from a canonical writer (the import pipeline, the admin desk, the seed) keeps that set: re-keying it into a revision's rows would strand every historical answer | `listeningCanonicalSetOwnership` → `"none" \| "revision" \| "legacy"`; publication materializes only when the item is not `legacy` |
> | a question row added by a staff append cannot silently do nothing on a live item, and the authoring desk shows the set learners actually get | `POST /api/admin/listening/tests/:id/questions` refuses a published/scheduled item with `revision_managed` (409, localized EN + UZ); the desk reads `listeningQuestionsForLiveTest` |
> | the MCQ Mastery drill only ever opens questions of the CURRENT set | `listeningQuestionIsLive` in `POST /api/listening/mcq` and both handlers of `/api/listening/mcq/:id` |
> | "questions missed" counts THE ATTEMPT'S OWN SET — a v1 attempt is never told it missed questions that did not exist when it was answered | `missedForAttempt` (`src/lib/data/full-listening.ts`) resolves the attempt's bound set first |
> | the schema change is additive, one nullable column, hash-pinned, and rewrites nothing | `drizzle/0051_listening_question_revision.sql` (`content_version_id` uuid NULL, FK `ON DELETE set null`, index `(test_id, content_version_id)`, every statement `IF NOT EXISTS`); journal idx 51; `ALLOWED_PENDING` + `APPROVED_INTEGRATION_SHA256` in `scripts/preview-qa-migrate.mjs`; J1–J5 assert the shape and that 0051 contains no `UPDATE`/`DELETE` |
> | the upgrade is rehearsed against an ACCEPTED-STATE database, not only a fresh one | `scripts/verify-listening-revision-migration.mjs` — builds the pre-0051 schema on real PostgreSQL, loads a published test with 2 legacy questions, an attempt and 2 answers, applies the real file, then proves: 10/10 checks (column/index/FK present; no row created or destroyed; every existing question stays unversioned; no orphaned answer; deleting a revision NULLs the column instead of cascading; the question's answers survive; re-apply is a no-op) |
> | 0051 applies cleanly to a fresh database too | `npm run -s qa:pg` → `migrations ok: 52 / 52` |
> | the revision snapshot carries the whole item — audio fields and the authored explanation included — so publication can rebuild the set and preview shows what publication will write | `listeningProjection`; `questionRowsFromSnapshot` maps `explanation ?? ""` (recording that none was authored, never inventing one) |
>
> **Deliberate non-changes, recorded so they are not "fixed" later.** The import pipeline, the admin
> append route (for draft items) and the seed remain canonical writers: they insert legacy
> (unversioned) rows deliberately, and the ownership rule above protects exactly those items. A
> formal `listening:full_test` authored natively still has no canonical package — already an
> OWNER-REVIEW item, unchanged here.
