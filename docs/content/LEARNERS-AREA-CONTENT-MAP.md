# Learners Area Content Map

Status: **implemented view**. Where content lives, which code owns it, which route
serves it and which table stores it. If a file and this table disagree, the file wins
— and this table should be fixed in the same change.

---

## 1. The canonical layer

| Concern | File |
| --- | --- |
| Modules, content types, tracks, reference rules | `src/lib/content/taxonomy.ts` |
| Question types, answer models, grading, answer-shape checks | `src/lib/content/question-types.ts` |
| Version identity, hashing, `pinVersion`, snapshots, attempt binding | `src/lib/content/versions.ts` |
| Draft → publish workflow and publication gate | `src/lib/content/authoring.ts` |
| Author registry (what can be created from scratch) | `src/lib/content/authors.ts` |
| Score policies and their versions | `src/lib/content/score-policy.ts` |
| Mock composition, navigation, timing, results | `src/lib/content/mocks.ts` |
| Lessons | `src/lib/content/lessons.ts` |
| Typed lesson blocks | `src/lib/content/blocks.ts` |
| Vocabulary packs as canonical content | `src/lib/content/vocabulary-packs.ts` |
| Assignments over canonical content | `src/lib/content/assignments.ts` |
| Source identity and duplicate detection | `src/lib/content/identity.ts` |

## 2. Ingestion

| Concern | File |
| --- | --- |
| Package envelope + validation levels | `src/lib/import/core/envelope.ts`, `parse.ts`, `validation.ts` |
| Identity and hashing | `src/lib/import/core/identity.ts` |
| Dry run and transaction rollback | `src/lib/import/core/dry-run.ts` |
| Pipeline, import ledger, source status | `src/lib/import/core/pipeline.ts` |
| Import capabilities registry | `src/lib/import/core/registry.ts`, `capabilities.ts` |
| Reading import and conversion | `src/lib/import/reading/*` |
| Listening import, conversion and legacy bridge | `src/lib/import/listening/*` |
| Zip/JSON transport, PDF text, asset staging | `src/lib/import/zip-transport.ts`, `pdf-text.ts`, `core/assets.ts` |

## 3. HTTP surface

| Route | Purpose |
| --- | --- |
| `/api/admin/content/validate` | pre-flight a package: issues, assets, source status, **duplicate candidates** |
| `/api/admin/content/import` | run an import through the pipeline |
| `/api/admin/content/template` | emit a package template for a content type |
| `/api/admin/content/items`, `.../[module]/[contentType]/[sourceRef]` | list and read canonical items and their revisions |
| `/api/admin/content/drafts` | create/update a draft revision |
| `/api/admin/content/versions/[id]/publication` | publication workflow for one revision |
| `/api/admin/content/authoring-capabilities` | which content types can be authored right now |
| `/api/lessons/[lessonId]`, `/api/lessons/blocks/[blockId]/answer` | learner lesson read + block answer |
| `/api/vocabulary/packs` | published lexical packs (DB first, built-in fallback) |
| `/api/assignments` | assignment list/create over canonical content (staff see what they created; a learner sees their own targets) |
| `/api/assignments/assignable` | staff-only: canonical items with a published revision that may be set as work |
| `/api/reading/**`, `/api/listening/**`, `/api/writing/**`, `/api/speaking/**`, `/api/grammar/**` | skill attempts and practice |
| `/api/search`, `/api/dictionary` | discovery over canonical content and the shared lexicon |

## 4. Storage

| Table | Holds |
| --- | --- |
| `content_versions` | every revision: identity, hashes, snapshot, publication, provenance. Written only by `pinVersion`, which every door uses: authoring, Reading and Listening imports, media lessons, lessons, vocabulary packs, and the backfill scripts |
| `content_imports` | the import ledger: which package arrived; the revision it produced is stored on the version row (`content_import_id`) |
| content tables (`general_reading_sets`, `listening_packages`, `writing_prompts`, `speaking_prompts`, `grammar_topics`, `vocabulary_topic_packs`, `video_lessons`, `lessons` + `lesson_blocks`) | the canonical content rows a revision describes |
| attempt tables (`reading_attempts`, `listening_attempts`, `writing_submissions`, `speaking_attempts`, `grammar_attempts`, `lesson_block_responses`) | what a learner did, each bound to the revision it was given |
| `mock_tests`, `mock_sections`, `mock_attempts` | the orchestration object and the frozen run |
| `assignments`, `assignment_targets` | work set against canonical content, per student |
| `lexemes` (+ `sense_key`), `lexical_occurrences`, `user_vocabulary`, `vocabulary_topic_packs` | the ONE lexical system (§31/§76) |
| `users`, `teacher_student_links`, `enrollments`, `courses`, `course_modules`, `units` | people and structure |
| `audit_log`, `activity_events` | who did what |

## 5. Legacy and compatibility (do not extend)

| Table / file | Status |
| --- | --- |
| `listening_tests`, `listening_questions`, `listening_mcq_sessions` | COMPATIBILITY ONLY — historical attempts render; new listening content is canonical |
| `reading_passages`, `reading_questions` (legacy) vs `general_reading_sets` | COMPATIBILITY ONLY for the old rows; the canonical path is `general_reading_sets` |
| `writing_lessons`, `writing_model_texts`, `writing_language_patterns`, `writing_translation_sets` | COMPATIBILITY ONLY, marked MIGRATE in the inventory |
| `video_lessons`/`video_lesson_questions` | canonical for the media lesson, kept because they hold the media reference |
| `src/lib/services/vocabulary/packs.ts` (built-in packs) | COMPATIBILITY ONLY — the fallback before any pack is published |
| `src/lib/data/reading-library.ts` | COMPATIBILITY ONLY — legacy library view |
| `src/db/seed.ts` | synthetic development fixtures only, never a content source |
| `scripts/content-backfill-imported-versions.ts` | idempotent, dry-run-first backfill that pins revisions for material imported before the importers did |

The authoritative classification with reasons is
`scripts/content-legacy-inventory.ts` (`npm run`-able, `--json` for machines); the
narrative version is [LEGACY-MIGRATION.md](LEGACY-MIGRATION.md).

## 6. Where to add something

1. New **content type** → `taxonomy.ts`, then an author in `authors.ts`.
2. New **question type** → `question-types.ts` + registry tests (see
   [QUESTION-TYPE-REGISTRY.md](QUESTION-TYPE-REGISTRY.md)).
3. New **skill surface** → a route in `src/app/api/**` and a thin service in
   `src/lib/**` that reads canonical content through `versions.ts`. No content data
   in components; no second content store anywhere.
