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
| APP-001 | canonical `/app` namespace | **DONE** | `src/app/app/{layout.tsx,(shell),(focus)}`; every authenticated page is under `/app`; APIs stay at `/api`. `tests/app-namespace.test.ts` |
| APP-002 | design preserved | **IN PROGRESS** | no token, class or primitive was changed by the move; the shell layout is the same markup, re-parented. Before/after capture is still owed (§65) |
| APP-003 | performance baseline | **NOT STARTED** | no baseline has been recorded yet; §4/§66 require measurements before any claim |
| LSN-001 | Listening Lessons | NOT STARTED | |
| LSN-002 | Description | NOT STARTED | |
| LSN-003 | Teacher Notes | NOT STARTED | |
| LSN-004 | private Student Notes (Xulosangiz) | NOT STARTED | no generic student-note table exists today; `lesson_progress.notes` is course-lesson scoped and must not be reused casually |
| LSN-005 | Academic catalogue | NOT STARTED | legacy library exists at `/app/listening` (`FullListeningLibrary`, `legacyListeningCards`) |
| LSN-006 | dynamic 5–10 activity hub | **IN PROGRESS** | `src/lib/listening/activities.ts` already derives activities from authored/structural facts (exam, review, script, mcq, matching, completion, retry, vocab) and hides a card when its content is absent — the hub must be driven from it, not from a fixed list |
| LSN-007 | formal exam | NOT STARTED | strong native focus exam already exists under `/app/listening/tests/[id]` (focus group) |
| LSN-008 | review evidence | NOT STARTED | revision/study surfaces exist |
| LSN-009 | Script Completion (full transcript, 5–7 blanks/part) | NOT STARTED | needs the owner ZIP to re-derive from source |
| LSN-010 | MCQ Mastery reuse | **IN PROGRESS** | server-authoritative staged engine already exists (`src/lib/services/listening/mcq-{access,payload,mastery}.ts`, `McqMastery.tsx`); the day program must reuse it, not duplicate it |
| LSN-011 | Matching practice | NOT STARTED | |
| LSN-012 | Completion practice | NOT STARTED | |
| LSN-013 | Listening vocabulary (canonical lexical) | NOT STARTED | |
| LSN-014 | Retry weak areas | NOT STARTED | |
| LSN-015 | General Listening is section-only (no full mode, no hub) | NOT STARTED | |
| LSN-016 | General Listening note-taking | NOT STARTED | |
| LSN-017 | General Listening highlight | NOT STARTED | |
| LSN-018 | General Listening vocabulary | NOT STARTED | |
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
| SEC-001 | auth preserved | **DONE** | one database-backed gate in `src/app/app/layout.tsx` covers the shell and focus groups; `browser smoke` `/app/*` → `/login?next=…`, `/api/*` → 401/405, never 500 |
| SEC-002 | private assets | **DONE (unchanged)** | private R2/S3 model untouched by this workstream |
| SEC-003 | answer secrecy | **DONE (unchanged)** | MCQ stage model untouched |
| SEC-004 | student-note privacy | NOT STARTED | arrives with LSN-004 |
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
