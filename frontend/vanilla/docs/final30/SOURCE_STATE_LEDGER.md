# SOURCE STATE LEDGER (per implemented route)
Legend: ✔ ported and unit-tested (jsdom) · ◐ ported, partly tested · ✖ not ported.

## admin/admissions (page.tsx, AdmissionQueue.tsx)
✔ loading skeleton `data-async-loading=management-admissions` · ✔ empty `reviewEmpty` · ✔ pending count badge · ✔ per-request note (≤500, trimmed→null) · ✔ approve/reject each behind ConfirmAction (reused shared dialog) · ✔ busy disables all triggers · ✔ error `people.failed + apiErrorMessage` · ✔ success refetches quietly (router.refresh) · ✔ recent decisions list with `—` for missing date · ✔ role gate → `/app` · ✔ 401→/login, 403→/app, malformed DTO→retry notice · ✔ text-only rendering (applicant name/message).
## admin/people (page.tsx, PeopleTable.tsx, RoleSelect.tsx)
✔ URL state q(≤100)/role/status/page sanitized like source · ✔ search form → SPA navigation · ✔ results/range text · ✔ desktop table + mobile cards (same controls) · ✔ own row/owner row locked · ✔ role options = server `grantableRoles` (+current) · ✔ ConfirmSelect semantics (select never shows new value before server OK; cancel; failure message) · ✔ suspend two-step with reason (≤500) · ✔ reactivate behind confirm · ✔ pagination links keep filters · ✔ EN/UZ labels · ◐ day/night + breakpoints rely on existing CSS (not browser-probed).
## admin/people/:id (page.tsx, StudentResults.tsx)
✔ non-UUID → not-found, no request · ✔ 404 → not-found · ✔ summary math (taken/latest/best/average/first→latest) · ✔ completed-of-total progress · ✔ SVG trend (last 20) · ✔ per-skill lists (30) · ✔ unavailable alert · ✔ out-of-range band rejected by adapter.
## admin/roster (page.tsx)
✔ chooser · ✔ status banner only for the 3 known words · ✔ assigned list, native unassign form · ✔ search (≤60) · ✔ candidates cap notice · ✔ assign form hidden at roster cap · ✔ no-teachers state.
## owner (page.tsx)
✔ stat cards (total/active, pending, teachers, integrations not-configured+unverified) · ✔ 7 links · ✔ brand preview (asset paths must match `/brand/…`, no `..`).
## owner/transfer (page.tsx, OwnershipTransferForm.tsx)
✔ button disabled until email+password · ✔ keepRole admin/teacher/student · ✔ exact body · ✔ success card + password wiped + refresh · ✔ password only in DOM, wiped on abort · ✔ wrong password does not log the owner out (F-2).
## owner/retention (page.tsx, RetentionRunner.tsx)
✔ 6 policy rows · ✔ preview/run buttons with `running` label · ✔ results with mode marker · ✔ native export GET form (pdf/docx/zip).
## owner/integrations (page.tsx, AiControlPanel.tsx)
✔ 4 states + badges · ✔ AI panel: ceiling, master, provider, model (≤100), fallback, per-provider secret *names*, config issues, effective, last change · ✔ nested error codes mapped (F-3).
## owner/dictionary (page.tsx, OwnerDictionary.tsx)
✔ overview · ✔ drafts list/edit/discard · ✔ add-lexeme/add-sense/edit-sense forms · ✔ publish loop with resume (capped 500 polls) · ✔ history + rollback · ✖ DictionaryPanel search/select (slot `ctx.dictionaryPanel`).
## teacher/students, students/:id (TeacherFeedbackForm, NewAssignmentForm, StudentResults)
✔ list/empty · ✔ detail sections · ✔ evaluation block (top-2 weaknesses, provenance label from server) · ✔ feedback form (required comment ≤2000, band 0–9 step .5) · ✔ assignment form (lazy assignable load, canonical wins and drops prompt link, title ≥3) · ✔ draft submissions have no feedback form.
## teacher/support (ResolveReportButton)
✔ list/empty · ✔ resolve with busy/error · ✔ 409/404 refresh silently.
## teacher/live-classes, :id (NewLiveClassForm, ClassStatusControls)
✔ list with status controls per state · ✔ new class form (title≥3, duration 15–240, http(s) URL) · ✔ detail facts, Set/Not set flags (URLs never rendered), roster/empty.

## admin/grammar, grammar/:id (GrammarImport, NewTopicForm, NewExerciseForm)
✔ list + topic cards · ✔ new topic (title 3..200, explanation ≥5) · ✔ import: `grammarBundleSchema` ported (strict keys, sentence 3..12000, options 2..6 unique, correct in options, topics ≤20, exercises ≤100, duplicate topic keys) · ✔ Apply only for the SAME validated text · ✔ 409 drops preview · ✔ exercise form: correct option select follows typed options, trimmed, ≥2 options · ✔ not-found.
## admin/reading, reading/:id (NewPassageForm, NewQuestionForm, PublicationControl)
✔ list with publication control (D-1) · ✔ new passage (title 3..200, body ≥50, level, minutes 5..90) · ✔ question types TF/YN/MCQ/short with reset of correct answer on type change · ✔ `revision_managed` message · ✔ answers shown to staff only · ◐ ResourceComposer slot.
## admin/writing (+new, +edit) (WritingContentForm, PublicationControl issueLabels)
✔ 5 kinds + topic section, counts per state, rows · ✔ per-kind payload exactly as source (empty→null, numeric coercion, line-split) · ✔ translation sentences add/remove/next position · ✔ model-text live word count · ✔ server issues localized, unknown → `write_failed` · ✔ publication with writing-specific type names · ◐ Task-1 visuals slot.
## shared PublicationControl
✔ state badge/select/schedule moment (UTC conversion) · ✔ MCQ-day, listening-blocker and writing-issue sentences localized · ✔ idempotent double click · ✔ scheduled without moment is sent as `publishAt:null` (source behaviour; server refuses).

## materials/:type, materials/:type/:id, ResourceComposer, upload engine
✔ kind list with visibility text/empty state/404 · ✔ editor reuses ONE composer per ownerType · ✔ composer loads via GET; load failure disables Save (cannot overwrite an unseen list) · ✔ add text/link/image/audio/file, move up/down, remove · ✔ preflight (policy), signature (magic bytes) before any request · ✔ real XHR progress, states queued/uploading/finalizing/complete/failed/cancelled, retry keeps the file · ✔ unfinished/failed uploads are not saved · ✔ stored file re-sent as retained key, new file as uploadId · ✔ server answer replaces the list · ✔ drop zone · ✔ abort cancels in-flight uploads.
## video-lessons (NewVideoLessonForm)
✔ standalone vs lesson-linked · ✔ transcript parser (timed/plain/mixed refused) · ✔ vocabulary example must occur in transcript or notes · ✔ questions parser (comprehension/gap_fill) · ✔ link refusal `reason` localized · ✔ publication control for admin/owner only.

## admin/content/workspace (ContentWorkspace)
✔ bank: 11 filters, 25/page, total, previous/next, clear · ✔ capabilities best-effort (module→type cascade; types without surface disabled) · ✔ item panel: versions, preview (TEXT only, answer-key + problems notices, canonical withheld => explained), publish/schedule/archive via the service, revise from the canonical snapshot (validate → draft with versionId + note), executable revision refused · ✔ new item: template/example, validate, save draft, import link only where an import surface exists, non-authorable blocks save · ✔ publish buttons mirror admin/owner, service decides.
## admin/reading/retention (+ /staged) (RetentionBankPanel, RetentionMeasurementEditor)
✔ five-level inventory with target text · ✔ filter/sort/pagination in the URL · ✔ row menu (roving focus, Escape/Tab/outside) · ✔ Archive = native confirm (source), Restore = none · ✔ Add/Change editor: Change loads the CURRENT version (failure => Retry, never an empty form); live count with level range; debounced server validation using the SAME endpoint as save (stale answers ignored); Save locked synchronously, never auto-retried, timeout says the outcome is unknown; 409 conflict banner · ✔ measurement builder (claims/groups/phrases, group points sum into the claim, canonical JSON, raw JSON kept when the shape is unknown) · ✔ staged review read-only (no writes).

## admin/reading/import (ReadingImport, ReadingTryout, reading-source, archive)
✔ file types via the shared upload policy · ✔ structured only with explicit authored data (JSON, fenced JSON, `data-reading-bundle` block, controls + `KEY` literal; sourceRef stamped with SHA-256 of the raw source) · ✔ everything else supplemental (preview ≤2000 chars, link to materials) · ✔ HTML scrubbed before parsing, scripts removed after, answer key read as a JSON literal (never evaluated) · ✔ ZIP: central directory validated first (≤200 files, ≤200 MB expanded, unsafe/duplicate names, encrypted, ZIP64, unsupported methods refused), bounded inflation (zip-bomb guard), ≤30 s, abortable · ✔ two candidate bundles => refused · ✔ local tryout (select/input, check/reset, fold-compare with accepted alternatives) · ✔ Import disabled unless the bundle parses (zod port incl. type aliases) · ✔ server codes mapped to localized text · ◐ PDF needs an injected reader.

## teacher/speaking (NewMaterialForm, EditMaterialForm, ManagedMaterialCard, BlockComposer, PrimaryFileField, useBlockDrafts, BlockRenderer, MaterialPlayer, SpeakingPromptComposer, StudyRichEditor)
✔ cards (category, author, inactive dimming, expand attachments) · ✔ rename/activate/delete (native confirm with attachment count) · ✔ create: category+title+primary (file with real progress, or http(s) link)+blocks; Submit locked while anything uploads · ✔ edit: seeded from stored data, retained files re-sent by objectKey and labelled "kept as-is", failed uploads omitted but kept for Retry, reorder by drag AND ▲▼ · ✔ renderer: only YouTube is framed (nocookie host, validated id), direct media native, else external link; read URLs must be same-origin or https · ✔ topic composer (admin/owner): browse+search existing topics, part/topic/questions, part-2 cue card, shared vs AI bank channels, vocabulary rows, study-support editors with allowlist sanitizer, publish/update, archive with explicit confirm, 409/400 mapped.

## admin/listening, listening/:id, listening/import (FullListeningLibrary, ListeningTestActions, ListeningImport canonical)
✔ library: collection tabs (uncategorised only when present), section filter for General, search, per-kind cards (full/section/legacy/authored), rename/delete actions, paging · ✔ test desk: MaterialPlayer (relative audio URLs are external links, exactly like `resolveEmbedSource`), answers for staff, canonical => redirect · ✔ import: schema-ready gate, JSON/ZIP package, server validation (no writes), per-asset pickers (declared assets only), preflight, uploads by id, dry run before import, publish + grade-impact checkboxes, source status, migrated-from notice, issues/warnings, result link, template downloads · ◐ legacy HTML/ZIP section: ported for structured practice (`DATA`/`PARTS`), research practice (`const D`) and canonical packages, single HTML (embedded recording/map extracted, never executed) or ZIP, explicit audio chooser when ambiguous, duration probe, map diagram as inert SVG, full in-memory tryout (all activities, Choose-TWO scoring), upload by id then POST; ✖ oldest exam-page format and authored-runtime fallback (refused).
## owner/dictionary — DictionaryPanel (owner mode)
✔ search (debounced, stale-safe, EN/UZ), combobox keyboard, hits as text, entry view (senses, examples with "more", tags, forms, collocations, synonyms/relations, attribution), expand/collapse all, edit/add sense/add word callbacks into the draft editor · ✖ student mode (recent, folders, save) belongs to the vocabulary module.

## Findings against the source (not fixed silently)
* **F-1** `RetentionRunner` “Run cleanup”, dictionary “Discard/Rollback” have NO confirmation in the source. Preserved exactly; adding one needs owner approval.
* **F-2** The shared `api-client` turns every 401 into a global logout event. `POST /api/owner/transfer` answers a wrong password with 401 `invalid_credentials`, so using it unchanged would sign the owner out on a typo. FINAL30 uses `rawJson` (same-origin, no-store, no redirect, 25 s timeout) which suppresses the event only for `invalid_credentials`. Integrator should decide whether to fix `api-client` instead.
* **F-3** `api-client` keeps only a *string* `error`; `/api/owner/ai-control` answers `{error:{code}}`. Same `rawJson` workaround.
* **F-4** `/api/admin/roster` takes form-encoded data and answers 303; it cannot be called by the JSON client. Native forms are kept.
* **F-5** Source `NewLiveClassForm` calls `new Date(value).toISOString()` unguarded (RangeError on an empty/invalid value). The port validates first.
* **F-6** Source `OwnerDictionary` publish loop is unbounded; the port stops after 500 polls and leaves “Continue publication”.
* **F-7** Owner overview needs the brand images; they are not part of the source snapshot (assets excluded).
* **F-8** Source cards (reading list) nest a PublicationControl inside an anchor; FINAL30 makes the title the link and the control a sibling (D-1).
* **F-9** Source `GrammarImport` and `grammarBundleSchema` require ≥3 characters for every option/sentence; fixtures with shorter options are (correctly) refused.
* **F-10** Closure-scoped “busy” flags are unsafe in a re-rendering view (a second submit reaches a new closure). All FINAL30 forms keep the guard in persisted state; a regression test covers video lessons.
* **F-11** The source `OpusHead` vs ogg distinction in `sniffAudio` is not needed for signature verification (any non-null result passes) and was dropped.
* **F-12** Retention `Archive` relies on `window.confirm` in the source; ported unchanged (injectable `ctx.confirm` for tests).
* **F-13** The workspace preview must never render executable material: the server answers `canonical:null` and the screen explains it instead of showing it; tests assert preview text with `<script>` is inert.
* **F-14** `ReadingImport.send(false)` posts `publish: !dryRun` = **true**: the Import button PUBLISHES the set immediately and overrides the bundle's own `publish` flag (the server comment says drafts unless the bundle says so). Ported unchanged; owner should decide if this is intended.
* **F-15** In the source tryout a question typed with an ALIAS (e.g. `TFNG`) gets a text box, because only the canonical ids `true_false_not_given`/`yes_no_not_given` supply TRUE/FALSE/NOT GIVEN options. Ported unchanged (the stored data is correct; only the preview control differs).
* **F-16** In the source, choosing a file whose `arrayBuffer()` never settles hangs the screen (abort is only checked between steps). The port races the read against the abort/timeout signal.
* **F-17** Found by testing: native `Element.append()` rendered `null`/`[object …]` text in forms; fixed with `put()` in every module (see TEST_EVIDENCE).
* **F-18** Source `EditMaterialForm` opens a link-primary material on an EMPTY Upload tab; the port opens on the Link tab with the stored URL.
* **F-19** Embedding is stricter than `lib/embed.ts`: exact YouTube hosts and an id pattern instead of `hostname.includes(...)`; the iframe URL is always `youtube-nocookie.com/embed/<id>`.
* **F-20** `ListeningImport.upload` (canonical) disables buttons only through a state set after an `await`; two quick clicks could reach the server twice. The port uses a synchronous flight guard.
* **F-21** `NewListeningQuestionForm`, `NewTestForm`, `NewPromptForm` are imported nowhere in this snapshot (dead code); not ported on purpose.
* **F-22** The legacy conversion is verified on a real file: Q1–17 `sentence_completion`, Q18–20 `map_labeling`, Q21–24 `mcq_single`, Q25–30 `mcq_multi` (three Choose-TWO pairs, options A–E kept multi-select), Q31–40 `note_completion`; map diagram of 23 validated shapes; 4 part ranges; 30 script gaps (ids remapped to 101+ because the source numbers exceed 200). Nothing was reclassified.
* **F-23** The source instruction text for each task card is taken with `textContent` and whitespace collapsed; in the real file adjacent elements have no whitespace between them, so headings and instructions run together ("Questions 1-10Complete…"). Ported as is; a separator would be a content decision for the owner.
