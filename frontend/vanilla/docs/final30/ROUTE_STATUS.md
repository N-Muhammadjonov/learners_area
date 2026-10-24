# FINAL30 ROUTE STATUS — PARTIAL (read this first)

Source pin `12308e89f67e573888ef4b23e6d85e005f2c2647` (SOURCE_SNAPSHOT verified: 1168/1168 SHA-256 match, 35 pages + 25 components present).
**PRODUCTION CHANGES: NONE.** No Arena/GitHub/Supabase/Railway/R2/Telegram access. No percentages are claimed.

Status vocabulary (strict). **CODE COMPLETE = 0 routes.** Nothing here has live integration, original-rendered comparison, or the 3-viewport × EN/UZ × day/night browser probes, so ordinary engineering remains for every route.
* `CLIENT IMPLEMENTED (jsdom fixtures)` — all source-defined client states ported + adversarial tests; server read adapter still PROPOSED.
* `PARTIAL` — implemented with a named missing dependency.
* `PRESERVED` — existing V4 partial left untouched.
* `NOT STARTED` — page source may have been read, nothing implemented.

| # | Route | Role | Status | Notes |
|---|---|---|---|---|
| 1 | /app/admin/admissions | admin, owner | CLIENT IMPLEMENTED | decide via existing `POST /api/admin/admission/:id/decide` |
| 2 | /app/admin/people | admin, owner | CLIENT IMPLEMENTED | role/status via existing PATCH/POST; server decides rank |
| 3 | /app/admin/people/:id | admin, owner | CLIENT IMPLEMENTED | StudentResults ported (band math copied, no re-grading) |
| 4 | /app/admin/roster | admin, owner | CLIENT IMPLEMENTED | native form POST kept (handler is form-encoded + 303) |
| 5 | /app/admin/grammar | admin, owner | CLIENT IMPLEMENTED | new topic + bundle import (zod rules ported, dry-run before apply) |
| 6 | /app/admin/grammar/:id | admin, owner | CLIENT IMPLEMENTED | new exercise form; correct option must be one of options |
| 7 | /app/admin/reading | admin, owner | CLIENT IMPLEMENTED | shared PublicationControl; D-1 (card link/control are siblings) |
| 8 | /app/admin/reading/:id | admin, owner | CLIENT IMPLEMENTED | question form + `ResourceComposer` (ported; fake-transport tests only) |
| 9 | /app/admin/writing | admin, owner | CLIENT IMPLEMENTED | sections, counts, rows, publication with localized issues |
| 10 | /app/admin/writing/:kind/new | admin, owner | CLIENT IMPLEMENTED | one editor for 5 kinds; payload mapping copied |
| 11 | /app/admin/writing/:kind/:id | admin, owner | CLIENT IMPLEMENTED | edit + publication + Task-1 visuals composer |
| 12 | /app/owner | owner | CLIENT IMPLEMENTED | brand preview needs `/brand/*` assets (absent from snapshot) |
| 13 | /app/owner/transfer | owner | CLIENT IMPLEMENTED | no invented dialog (source has none); F-2 |
| 14 | /app/owner/retention | owner | CLIENT IMPLEMENTED | export = native GET form; F-1 |
| 15 | /app/owner/integrations | owner | CLIENT IMPLEMENTED | AI control via existing GET/POST; F-3 |
| 16 | /app/owner/dictionary | owner | CLIENT IMPLEMENTED | overview, drafts, publish loop, history, rollback + `DictionaryPanel` (owner mode ported: search EN/UZ, keyboard listbox, entry/senses, relations, edit/add callbacks) |
| 17 | /app/owner/audit | owner | PRESERVED | existing `owner-audit` view matches source states; unchanged |
| 18 | /app/teacher/students | teacher, admin, owner | CLIENT IMPLEMENTED | roster scoping server-side |
| 19 | /app/teacher/students/:id | teacher, admin, owner | CLIENT IMPLEMENTED | feedback + assignment forms |
| 20 | /app/teacher/support | teacher, admin, owner | CLIENT IMPLEMENTED | resolve via existing PATCH |
| 21 | /app/teacher/live-classes | teacher, admin, owner | CLIENT IMPLEMENTED | create/status/recording |
| 22 | /app/teacher/live-classes/:id | teacher, admin, owner | CLIENT IMPLEMENTED | server-clock join state |
| 23 | /app/admin/content | admin, owner | PRESERVED | untouched |
| 24 | /app/admin/materials | teacher, admin, owner | PRESERVED | untouched |
| 25 | /app/admin/content/workspace | admin, owner | CLIENT IMPLEMENTED | bank search/filters, item panel (versions, preview as text, publish/schedule/archive), revise from canonical snapshot, new item (template/example/validate/draft); only existing handlers |
| 26 | /app/admin/listening | admin, owner | CLIENT IMPLEMENTED | library (collections, section filter, search, cards by kind) + rename/delete actions + paging |
| 27 | /app/admin/listening/:id | admin, owner | CLIENT IMPLEMENTED | legacy desk (audio, answers for staff, actions); canonical tests redirect to the learner page |
| 28 | /app/admin/listening/import | admin, owner | **PARTIAL** | canonical flow complete + LEGACY section ported and verified against a REAL owner file (`Listening_Test_1.html`: 40 questions, map, Choose-TWO pairs, script gaps, embedded 16 MB recording): structured practice (`DATA`/`PARTS`), research practice (`const D`), canonical `data/package.json`, single HTML or ZIP. **Still refused with an explicit message:** the oldest exam-page format (`01_full_exam.html`, `#l1` controls) and the authored-runtime fallback (sandboxed frame) — no sample of either exists to verify a port against |
| 29 | /app/admin/materials/:type | teacher, admin, owner | CLIENT IMPLEMENTED | unknown kind => 404; index stays the PRESERVED V4 view |
| 30 | /app/admin/materials/:type/:id | teacher, admin, owner | CLIENT IMPLEMENTED | same composer, different ownerType |
| 31 | /app/admin/reading/import | admin, owner | CLIENT IMPLEMENTED | zod schema + safe ZIP reader (no library, bounded inflation) + html/docx/json/txt readers + local tryout; **PDF needs an injectable pdf.js reader (not bundled)**; Import publishes (source behaviour, F-14) |
| 32 | /app/admin/reading/retention | admin, owner | CLIENT IMPLEMENTED | inventory, bank table, accessible row menu, add/change editor with live server validation + form measurement builder; archive keeps the source's native confirm |
| 33 | /app/admin/reading/retention/staged | admin, owner | CLIENT IMPLEMENTED | read-only QA hold review |
| 34 | /app/admin/video-lessons | teacher, admin, owner | CLIENT IMPLEMENTED | link-based authoring (no file upload in the source form); publication control admin/owner only |
| 35 | /app/teacher/speaking | teacher, admin, owner | CLIENT IMPLEMENTED | materials: create/edit/rename/activate/delete, block composer (drag + ▲▼, real upload states), primary file/link, embeds (YouTube only) · admin/owner: topic composer (study-support rich editor with allowlist sanitizer, vocabulary, archive confirm) |

**Counts:** CODE COMPLETE 0 · CLIENT IMPLEMENTED 31 · PARTIAL 1 · PRESERVED 3 · NOT STARTED 0 (= 35).
**Route audit coverage:** 33/35 page sources read with their dependencies and handlers (owner/audit compared with its existing view). 2/35 NOT audited: admin/content and admin/materials (PRESERVED, untouched).
**The one PARTIAL:** `admin/listening/import` — two legacy INPUT shapes are not ported (the oldest `01_full_exam.html` exam page and the authored-runtime fallback that needs the sandboxed `allow-scripts` frame). They are refused with a localized problem, never guessed; everything else on the page is ported and the legacy structured format is verified on a real file.
**Components (25 scoped):** ported 22 — AdmissionQueue, PeopleTable, RoleSelect, StudentResults, GrammarImport, NewTopicForm, NewExerciseForm, NewPassageForm, NewQuestionForm, NewVideoLessonForm, PublicationControl, WritingContentForm, ContentWorkspace, RetentionBankPanel, RetentionMeasurementEditor, ReadingImport, OwnershipTransferForm, RetentionRunner, AiControlPanel, TeacherFeedbackForm, NewAssignmentForm (+ReadingTryout). Not ported (3, verified by `grep`): NewListeningQuestionForm, NewTestForm, NewPromptForm are **orphans — imported by no page or component in this snapshot**; AccessRequestForm is student-facing (`/pending`), not a staff route. Also ported outside the 25: ResourceComposer + staff upload engine, DictionaryPanel (owner mode), OwnerDictionary, ListeningImport (canonical + legacy structured/research), ListeningTryout, FullListeningLibrary (management), ListeningTestActions, speaking block composer/primary field/prompt composer/study editor, ResolveReportButton, NewLiveClassForm, ClassStatusControls.
