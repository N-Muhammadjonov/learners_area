# Preview migration approval package: Writing (0031–0034)

Status: **NOT APPLIED to any shared database.** This document asks for approval; it applies nothing.
Prepared from the committed SQL files in `drizzle/`, not from memory.

## 0. Read this first: the real scope of a Preview migration

- The runner (`drizzle-orm` `migrate()`, used by `scripts/preview-qa-migrate.mjs` and `npm run db:migrate`) applies **every pending migration in journal order**. It cannot apply 0031–0034 on their own.
- The repo's own records say that **0029 and 0030 are also not applied to Preview** (`docs/VOCABULARY-ARCHITECTURE.md` lines 5–7 and 803; `docs/vocabulary-acceptance/VOCABULARY_DEFECT_LEDGER.json` EXT-1).
- So if Preview is really at 0028, one run applies **0029 → 0030 → 0031 → 0032 → 0033 → 0034**. The actual pending list must be confirmed with the read-only `--plan` step below before anything is applied.
- **0029 is not purely additive.** It back-fills existing rows: it runs `UPDATE lexemes SET lexical_unit_id = …`, inserts derived rows into `lexical_units` / `lexical_unit_forms`, and drops NOT NULL on `lexical_occurrences.passage_id` and `lexical_occurrences.lexeme_id`. It deletes no rows. It is a separate, earlier owner decision. It is summarized in §5 so the approval can be explicit.
- The guarded Preview runner only allowlists `0025`–`0028` (`ALLOWED_PENDING`). It will **refuse** any later pending migration until that list is extended, which is a one-line code change made only after approval.

## 1. 0031_writing_workspace

| Item | Value |
|---|---|
| Purpose | Data model for the Writing workspace: lessons, Real Exam (single task), Grade My Work, Translation, Typing model texts, Language patterns |
| Tables created (12) | `writing_lessons`, `writing_lesson_progress`, `writing_exam_sessions`, `writing_grade_requests`, `writing_translation_sets`, `writing_translation_sentences`, `writing_translation_attempts`, `writing_translation_answers`, `writing_model_texts`, `typing_run_texts`, `writing_language_patterns`, `writing_pattern_bank` |
| Enums created | None. Reuses the existing `publication_state` and `writing_task_type` |
| Tables altered | None |
| Existing rows modified / deleted | NO / NO |
| Destructive | NO |
| Backfill | NO |

Columns (exact, from SQL):
- **writing_lessons**: id uuid PK; title varchar(200) NOT NULL; category varchar(40) NOT NULL CHECK in (task1, task2, structure, ideas, coherence, vocabulary, grammar, mistakes); summary text; body text NOT NULL; duration_minutes smallint CHECK 1–240; position int NOT NULL DEFAULT 0; publication_state NOT NULL DEFAULT 'draft'; publish_at timestamptz; source_ref varchar(80); created_at, updated_at. Unique partial index on source_ref.
- **writing_lesson_progress**: user_id → users ON DELETE CASCADE; lesson_id → writing_lessons ON DELETE CASCADE; completed_at; PK (user_id, lesson_id).
- **writing_exam_sessions**: submission_id PK → writing_submissions CASCADE; user_id → users CASCADE; task_type; started_at; duration_seconds CHECK in (1200, 2400); expires_at; finalized_at; CHECK expires_at = started_at + duration. Index (user_id, started_at DESC).
- **writing_grade_requests**: id; user_id → users CASCADE; task_type; question_text CHECK 10–4000 chars; essay_text CHECK 1–20000; word_count ≥ 0; status CHECK in (pending, evaluated, failed); last_error varchar(60); claimed_at; analysis jsonb; idempotency_key varchar(64) NOT NULL; created_at; evaluated_at. Unique (user_id, idempotency_key); index (user_id, created_at DESC).
- **writing_translation_sets**: id; title(200); topic(120); question_type CHECK in (opinion, discussion, problem_solution, advantages_disadvantages, two_part); task_type DEFAULT task2; target_band smallint CHECK in (6, 7, 8); prompt_text; provenance(200) NOT NULL; publication_state DEFAULT draft; publish_at; source_ref (unique partial); created_at, updated_at.
- **writing_translation_sentences**: id; set_id → sets CASCADE; position smallint CHECK 1–40; uzbek_source; model_english; accepted_alternatives, notes, target_lexical_items jsonb DEFAULT '[]'; UNIQUE (set_id, position).
- **writing_translation_attempts**: id; user_id → users CASCADE; set_id → sets CASCADE; started_at; completed_at; status CHECK in (in_progress, completed); elapsed_ms; overall_estimate, meaning_score, grammar_band, vocabulary_band real. Index (user_id, started_at DESC).
- **writing_translation_answers**: id; attempt_id → attempts CASCADE; sentence_id → sentences CASCADE; answer_text; evaluation_status CHECK in (exact, evaluated, unavailable); verdict CHECK in (correct, acceptable, needs_revision); meaning_preserved 0–100; grammar_band, vocabulary_band 0–9; feedback; improved_version; tries DEFAULT 1; created_at; UNIQUE (attempt_id, sentence_id).
- **writing_model_texts**: id; title(200); task_type; topic(120); target_band numeric(2,1) CHECK 8–9; body CHECK 200–8000 chars; word_count > 0; provenance(200) NOT NULL; publication_state DEFAULT draft; publish_at; source_ref (unique partial); created_at.
- **typing_run_texts**: run_id PK → typing_runs CASCADE; model_text_id → writing_model_texts CASCADE; mistakes int ≥ 0 DEFAULT 0.
- **writing_language_patterns**: id; pattern(240); function CHECK in (collocation, sentence_frame, cohesion, comparison, concession, trend, argument); task_type; topic(120); target_band smallint 5–9; example ≤ 400 chars; usage_note; provenance(200) NOT NULL; publication_state DEFAULT draft; publish_at; source_ref (unique partial); created_at.
- **writing_pattern_bank**: user_id → users CASCADE; pattern_id → patterns CASCADE; saved_at; PK (user_id, pattern_id).

Dependencies: existing `users`, `writing_submissions`, `typing_runs` and the enums `publication_state` and `writing_task_type`.

## 2. 0032_writing_exam_papers

| Item | Value |
|---|---|
| Purpose | Real Exam papers: Task 1 (20 min), Task 2 (40 min), Full Writing (60 min, both tasks) under one server-held deadline; plus an optional link from Grade My Work to a published prompt |
| Tables created | `writing_exam_papers`, `writing_exam_paper_entries` |
| Tables altered | `writing_grade_requests` (a 0031 table): `ADD COLUMN prompt_id uuid REFERENCES writing_prompts(id) ON DELETE SET NULL` (nullable) |
| Existing rows modified / deleted | NO / NO (the new column is NULL for existing rows) |
| Destructive / Backfill | NO / NO |
| Contains `writing_stealing_sessions`? | **NO** (verified by test `writing-language-stealing-flow`) |

- **writing_exam_papers**: id; user_id → users CASCADE; mode CHECK in (task1, task2, full); started_at; duration_seconds; expires_at; finalized_at; finalize_reason CHECK in (submitted, timeout, abandoned). CHECKs: mode↔duration (1200/2400/3600); expires_at = started_at + duration; finalized_at and finalize_reason both set or both NULL. Index (user_id, started_at DESC). **Unique partial index (user_id) WHERE finalized_at IS NULL**, so each learner has at most one open paper.
- **writing_exam_paper_entries**: paper_id → papers CASCADE; position CHECK in (1, 2); task_type; prompt_id → writing_prompts (no cascade); submission_id UNIQUE → writing_submissions CASCADE; draft_revision int ≥ 0 DEFAULT 0; saved_at; PK (paper_id, position); UNIQUE (paper_id, task_type).

Depends on: 0031 (`writing_grade_requests`) and the existing `writing_prompts` and `writing_submissions`.

## 3. 0033_writing_language_stealing

| Item | Value |
|---|---|
| Purpose | Language Stealing 7-step, resumable workflow per learner per model text |
| Tables created | `writing_stealing_sessions` |
| Tables altered | None |
| Existing rows modified / deleted | NO / NO |
| Destructive / Backfill | NO / NO |

- Columns: id uuid PK; user_id → users ON DELETE CASCADE; model_text_id → writing_model_texts ON DELETE CASCADE; step smallint DEFAULT 1 CHECK 1–7; brainstorm, draft, comparison, rewrite text.
- **JSON arrays**: selected_pattern_ids, memorised_pattern_ids and rewrite_pattern_ids are jsonb NOT NULL DEFAULT '[]'.
- **Day-3 field**: rewrite_available_at timestamptz. This is the server-held unlock time for the rewrite step.
- **Timestamps**: completed_at, created_at DEFAULT now(), updated_at DEFAULT now().
- **Unique**: (user_id, model_text_id), so each learner has one session per text.

Depends on: 0031 (`writing_model_texts`).

## 4. 0034_typing_duration_presets

| Item | Value |
|---|---|
| Purpose | Record the Typing duration preset (1/2/3 min) in history |
| Tables altered | `typing_run_texts` (a 0031 table): `ADD COLUMN preset_seconds smallint CHECK (preset_seconds IS NULL OR preset_seconds IN (60, 120, 180))` |
| Existing rows modified / deleted | NO / NO. Old runs stay NULL, shown as "Full text"; no invented preset |
| Destructive / Backfill | NO / NO |

Depends on: 0031.

## 5. 0029 / 0030: included automatically if still pending (summary only)

- **0029_vocabulary_architecture**:
  - New tables: `lexical_units`, `lexical_unit_forms`, `user_vocabulary_contexts`.
  - Altered: `lexemes` gets a new `lexical_unit_id` column. `lexical_occurrences` gets source/listening/video/time/resolution columns plus CHECK constraints, and DROP NOT NULL on `passage_id` and `lexeme_id`.
  - **Modifies existing rows: YES.** It back-fills `lexemes.lexical_unit_id` and inserts derived units/forms. Deletes data: NO. A conditional unique index is created only when no duplicates exist.
- **0030_general_reading**: new tables `general_reading_sets`, `general_reading_passages`, `general_reading_progress`. Additive; no existing rows touched.

## 6. Application order, rollback and forward-only risk

- **Order**: journal order. Whatever is pending among 0029 → 0030 → 0031 → 0032 → 0033 → 0034 runs in that sequence. 0032, 0033 and 0034 each depend on 0031.
- **Rollback**: there are no down-migrations in this repo. 0030–0034 could be rolled back by dropping the new tables/column, but that is a destructive manual operation and needs its own approval. 0029's back-fill is not cleanly reversible. **A recovery point (snapshot/PITR/branch) must be taken first.** The guarded runner requires `PREVIEW_QA_BACKUP_REF` for `--apply`.
- **Forward-only risk**: low for 0030–0034 (new objects; nullable columns; CHECKs only on new columns). Moderate for 0029 (it rewrites a column on existing `lexemes` rows, and its conditional unique index depends on Preview data).

## 7. Local evidence (isolated databases only)

- A fresh real PostgreSQL 16 (embedded, `/tmp`, never shared) ran `drizzle-kit migrate` on the full chain: **35/35 applied, 0 failures**. All Writing tables are present; `typing_run_texts.preset_seconds` is smallint and nullable; `writing_grade_requests.prompt_id` is uuid and nullable.
- PGlite test `writing-language-stealing-flow` applies migrations up to 0031, inserts a row, then applies 0032 → 0033 → 0034. The existing row is untouched and 0032 does not contain the stealing table.
- The schema (`src/db/schema.ts`) matches the SQL; the test suite runs against the SQL-migrated database.

## 8. Preview database target

**PREVIEW DATABASE TARGET: UNRESOLVED.** The sandbox has no `DATABASE_URL`, no Vercel CLI or token, and GitHub returns 403 for deployment details. GitHub environments `Preview` and `Production` exist, but which database Vercel's Preview environment points to cannot be read from here. `docs/DEPLOYMENT-PORTABILITY.md` also states that preview isolation has never been verified. **Nothing will be run until the owner supplies the approved fingerprint.**

## 9. Exact command (after approval only; run by someone holding the Preview credentials)

```bash
# 0. Take a Preview DB snapshot/PITR point first; note its id.
export DATABASE_URL='<Preview QA url — never pasted into chat>'
export PREVIEW_QA_DB_FINGERPRINT='<owner-approved hex>'
export PREVIEW_QA_SERVER_IDENTITY='<owner-approved hex>'
export PREVIEW_QA_PROJECT_REF='<ref, if Supabase pooler>'
export PREVIEW_QA_BACKUP_REF='<snapshot id>'
node scripts/preview-qa-migrate.mjs --fingerprint   # read-only: confirm identity is Preview, not Production
node scripts/preview-qa-migrate.mjs --plan          # read-only: lists the ACTUAL pending set
# Only if --plan shows exactly the approved set, AND ALLOWED_PENDING has been extended
# (in a reviewed commit) to that set:
node scripts/preview-qa-migrate.mjs --apply
```

`--apply` applies **all** pending migrations, in order. It refuses: Production markers, identity mismatch, pending migrations outside the allowlist, and destructive SQL.
