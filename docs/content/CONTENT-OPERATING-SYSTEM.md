# Learners Area Content Operating System

Status: **Phase 2 (Content OS) — canonical registries, versioning, publication, composition
(lessons, media, mocks, assignments), identity and migration tooling are implemented and
test-covered. The honest per-area state, including what is still PARTIAL, is
`IELTS-COVERAGE-MATRIX.md`; the current report is `PHASE-2-FINAL-REPORT.md`.**
Owner of truth: this file describes the architecture; `src/lib/content/*` and
`src/lib/import/*` are the executable parts of it.

The previous workstream built the *ingestion* half: external source → canonical
structured package → validation → PostgreSQL + private object storage → native
renderer. This document describes the *product model* half that sits on top of it:
how every educational object is classified, versioned, composed, published,
attempted and reviewed.

---

## 1. The one rule

Learners Area does not store "uploaded files". It stores **canonical learning
objects**, and files are one way to create them.

```
AUTHOR / AI / IMPORT                       COMPOSITION
        │                                       │
        ▼                                       ▼
  CANONICAL LEARNING OBJECT ──────────► mock / assignment / practice set / lesson
        │                                       │
        ▼                                       ▼
  VERSIONED CONTENT STORE ────────────► LEARNER ATTEMPT (bound to a version)
                                                │
                                                ▼
                                     SCORE / RIWI / REVIEW
                                                │
                                                ▼
                                     PROGRESS / RETENTION / MASTERY
```

Two invariants hold everywhere below:

1. **A reference, not a copy.** A Reading passage that appears in the library, a
   lesson, a teacher assignment and a mock exists once. Composition objects
   reference it (and, for formal assessment, pin its version).
2. **Presentation belongs to the application.** Content data never carries CSS,
   class names, layout choices or executable markup. Imported HTML is *source
   material to convert*, never a runtime.

## 2. Hierarchy (course → … → attempt)

The shared layers deliberately carry no IELTS assumptions; IELTS rules live in
domain adapters (`src/lib/content/ielts.ts`).

| Layer | Meaning | IELTS example | Other courses | Where it lives |
|---|---|---|---|---|
| Course | A product line a learner enrols in | IELTS | SAT (future) | `courses` |
| Track | Variant within a course | Academic / General Training | — | `track` in content metadata |
| Module | Skill / subject area | Listening, Reading, Writing, Speaking, Grammar, Vocabulary, TED/Podcast, Mock | — | `src/lib/content/taxonomy.ts` (`CONTENT_MODULES`) |
| Content type | A kind of learning object inside a module | `full_test`, `general_set`, `task1`, `cue_card` | — | content-type registry (`src/lib/import/core/registry.ts`) |
| Collection | Curated grouping shown as a library facet | Academic Listening, Writing Task 2 | — | content metadata + library facets |
| Content unit | The actual learning object | one full Listening test, one passage, one prompt | — | module tables + `content_versions` |
| Composition | A reference-based arrangement | sectional mock, full mock, practice set, assignment, lesson | — | `mock_*`, `assignments`, `lessons` + `resource_blocks` |
| Attempt | One learner's run at a unit or composition | Listening attempt, mock attempt | — | per-domain attempt tables, bound to `content_versions` |

## 3. What exists today (verified, not aspirational)

**Ingestion (Master Prompt 1, checkpoint `5e078bb`/`cf9d76c`).**
Shared envelope + registry (`src/lib/import/core/`), Listening canonical v2 with
legacy conversion (`src/lib/import/listening/`), Reading canonical v1 over the
existing authored bundle (`src/lib/import/reading/`), ZIP transport that treats an
archive as a container (`src/lib/import/zip-transport.ts`), and the admin endpoints
`/api/admin/content/{import,validate,template}` plus
`/api/admin/listening/tests/[id]/convert`, backed by the `content_imports` ledger
(migration 0040).

**Canonical domain models already in PostgreSQL (106 tables; the universe is
enumerated and checked — see `scripts/content-legacy-inventory.ts`).**

| Module | Real tables | Coverage |
|---|---|---|
| Listening | `listening_tests`, `listening_questions`, `listening_packages` (+`legacy_runtime`), `listening_attempts`, `listening_answers`, `listening_drafts`, `listening_activity_runs`, `listening_mcq_sessions` | Full test, activities, autosave drafts, MCQ mastery drill |
| Reading | `reading_passages`, `reading_passage_paragraphs`, `reading_question_groups`, `reading_questions`, `reading_attempts`, `reading_answers`, `general_reading_sets/passages/progress`, `retention_*` | Academic + General, grouped questions with shared stimuli, retention rotation |
| Writing | `writing_prompts`, `writing_submissions`, `writing_feedback`, `writing_lessons`, `writing_model_texts`, `writing_pattern_bank`, `writing_grade_requests`, `writing_exam_papers/sessions/entries`, `writing_translation_*`, `writing_language_patterns` | Task 1/2, model texts, timed exam papers, translation, language-stealing |
| Speaking | `speaking_prompts` (bank: part, cue card, follow-ups, `externalId`, `availableIn`), `speaking_attempts`, `speaking_materials`, `live_partner_*` | Bank-driven Parts 1–3, AI practice, shadowing, live partner |
| Mock | `mock_tests` (id, courseId, title, skill), `mock_attempts` (rawScore, estimatedBand, skillBreakdown) | **Catalogue + results only — no membership, no versions** |
| Assignment | `assignments` (single `targetUserId`, `relatedWritingPromptId`), `assignment_responses` | **Writing-prompt assignment only** |
| Course / lesson | `courses` → `course_modules` → `units` → `lessons` → `material_blocks` / `resource_blocks`, `lesson_progress`, `video_lessons`, `video_lesson_questions/progress` | Complete hierarchy; content blocks are typed, not HTML |
| Vocabulary / lexical | `lexemes`, `lexical_units`, `lexical_unit_forms`, `lexical_unit_pronunciations`, `lexical_occurrences`, `user_vocabulary`, `user_vocabulary_contexts`, `vocab_folders`, `vocab_point_events` | One canonical lexical system, occurrence-based (no per-module dictionaries) |
| Grammar | `grammar_topics`, `grammar_exercises` (options, correctOption, targetStructures, translate/activate prompts), `grammar_attempts` | Concept → exercise → production task |
| Evaluation | `evaluations` (provider/model/rubric/prompt versions, criteria, verdict), `coach_weaknesses`, `writing_grade_requests` | RIWI contract with versioned provenance |

**Cross-cutting surfaces (Phase 2, §Z/§AA/§AC/§AD).**

| Surface | File | What it is |
|---|---|---|
| Native preview | `src/lib/content/preview.ts` | One projection per authorable type over the registry: the same canonical shape the learner renderer consumes, no publication required, staff-only, revision-identified, optional regions fail locally and core regions fail closed |
| Content bank | `src/lib/content/bank.ts` | A staff-only, SQL-filtered, paginated, faceted read over every canonical item (module · contentType · present state · has-ever state · track · identity · title · free text · version · changed-between) — not a title search. Rendered as the bank panel of the workspace (`GET /api/admin/content/bank`) |
| Authoring workspace | `/admin/content/workspace` (`ContentWorkspace.tsx`) | ONE admin workspace: template → validate → preview → save draft → revise → publish/schedule/archive. It calls the same APIs everyone else does and has no writer of its own |
| Learner timeline | `src/lib/data/attempt-timeline.ts` | The seven real attempt kinds projected into one learner history BY REFERENCE (table + id). It owns no table and duplicates nothing |

## 4. Gap register (what Phase 2 is closing)

| # | Gap | Impact | Phase 2 status |
|---|---|---|---|
| G1 | No shared taxonomy/registry module: module lists were duplicated in each feature | composition and reporting cannot agree on what a module *is* | **closed** by `src/lib/content/taxonomy.ts` |
| G2 | Question behaviour was implicit in components: Reading's DB enum has 4 values, Listening's has 2, and grading was one generic string match | a new question type needed React edits | **closed** by `src/lib/content/question-types.ts` (Listening + Reading registries, answer models, graders, import shapes) |
| G3 | No content versioning: editing a prompt or a key changed what a historical attempt appeared to have tested | §13/§42/§72 violation | **closed** by `content_versions` + attempt binding (`src/lib/content/versions.ts`) |
| G4 | Mock was a catalogue row; no membership, no compatibility rules, no version binding, no sectional composition | §12–§21 cannot be satisfied | **closed** by `mock_sections` + `src/lib/content/mocks.ts` |
| G5 | Assignment referenced only a Writing prompt and exactly one learner | §24–§25 covered only one module | **closed** by `assignment_items` (reference-based, multi-item, multi-learner) |
| G6 | Hard-coded content still in code: `TOPIC_PACKS` in `src/lib/services/vocabulary/packs.ts`, IELTS lesson copy in course pages | §100 "no deployment per content" | **partial** — inventory below; vocabulary packs have a canonical target (`user_vocabulary.topicPack`) but no authoring UI yet |
| G7 | Legacy authored runtime still stored for pre-existing Listening tests | §93/§95 | **partial** — conversion pipeline + owner-gated script exist; production rows need owner approval to convert |
| G8 | Reading question-type coverage is narrower than IELTS (no matching headings/features/sentence-endings families in the enum; `typeCode` is free-form) | §7 violation | **partial** — registry declares the missing types with answer models; import + renderer wiring for the new codes is the next checkpoint |
| G9 | Owner authoring UI exists per module but not as one "Content → Add" workflow | §34/§109 | **closed** by `/admin/content/workspace` (§AA) + the shared bank (§AC) |

### What Phase 2 did not close (kept honest here, not only in the matrix)

* **G6 (hard-coded content)** — vocabulary packs now HAVE a canonical target and an author,
  and the built-in list is a pre-publication fallback only; IELTS lesson copy in course
  pages is still code.
* **G7 (legacy Listening runtime)** — conversion tooling and the owner gate exist; the
  production rows still convert only with owner approval. This is an OWNER action, not a
  code gap.
* **G8 (Reading question-type coverage)** — the registry declares the missing IELTS
  families with answer models; import and renderer wiring for the new codes is future work.
* **Validation matrix** — per-type validation is real and asserted; a single generated
  "every content type × every check" matrix document is not emitted.
* **Autosave/resume/retry** — uniform for Listening drafts; canonical lessons and media do
  not yet have a resume contract.
* **§83–§89 UI polish** — the security and RIWI invariants hold; the polish items are not
  all re-verified after Phase 2.
* **Browser/Preview acceptance** — EXTERNALLY UNVERIFIED (no browser gate ran here;
  jsdom ≠ browser).

## 5. Control flow of a content change

```
owner/teacher/AI
   │  (structured package | manual form | converted legacy)
   ▼
validation ── structural (schema) ─ semantic (domain) ─ cross-reference (references exist,
   │          are eligible, track matches) ─ assets (declared, owned, finalized, hashed)
   ▼
content_versions row  (immutable for published assessment; new version on answer-key change)
   │
   ├─ draft ──► preview (native renderer) ──► publish (server-authorized, audited)
   │
   └─ compositions (mock / assignment / lesson) reference {contentType, sourceRef, version}
          │
          ▼
      learner attempt ──► bound to the version it started with ──► results / review / history
```

## 6. Related documents

- `LEARNERS-AREA-CONTENT-MAP.md` — module-by-module map: implementation → canonical entity → renderer → attempt → results → target.
- `IELTS-COVERAGE-MATRIX.md` — honest IMPLEMENTED / PARTIAL / LEGACY / MISSING marks.
- `MOCK-ARCHITECTURE.md` — composition, timing, navigation, scoring, version binding.
- `QUESTION-TYPE-REGISTRY.md` — every canonical question type with its answer model and grading.
- `CONTENT-VERSIONING.md` — version semantics, immutability rules, attempt binding.
- `AUTHORING-WORKFLOW.md` — the owner/teacher path from source to publication.
- `LEGACY-MIGRATION.md` — legacy inventory, classification and the migration runbook.
- `PHASE-2-FINAL-REPORT.md` — the Phase-2 acceptance report: what is verified, what is not, and every OWNER/EXTERNAL action.
- Master Prompt 1 documents: `../LISTENING-SOURCE-ZIP-CONTRACT.md`, `../AUTHORED-LISTENING-RUNTIME.md`, `../LEXICAL-ARCHITECTURE.md`.
