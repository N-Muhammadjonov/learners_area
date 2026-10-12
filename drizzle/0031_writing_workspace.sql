-- 0031 Writing workspace (owner master prompt sections 35-44).
-- Additive only: NEW tables. No existing table, column, row or id changes, so
-- every current query keeps working whether or not this migration has run.
-- Content tables start empty: nothing here seeds lessons, sets, model texts or
-- patterns. Staff import reviewed content through /admin/writing/import.
CREATE TABLE writing_lessons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title varchar(200) NOT NULL,
 category varchar(40) NOT NULL CHECK (category IN ('task1','task2','structure','ideas','coherence','vocabulary','grammar','mistakes')),
 summary text,
 body text NOT NULL,
 duration_minutes smallint CHECK (duration_minutes BETWEEN 1 AND 240),
 position integer NOT NULL DEFAULT 0,
 publication_state publication_state NOT NULL DEFAULT 'draft',
 publish_at timestamptz,
 source_ref varchar(80),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
)
--> statement-breakpoint
CREATE UNIQUE INDEX writing_lessons_source_ref_idx ON writing_lessons (source_ref) WHERE source_ref IS NOT NULL
--> statement-breakpoint
CREATE TABLE writing_lesson_progress (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 lesson_id uuid NOT NULL REFERENCES writing_lessons(id) ON DELETE CASCADE,
 completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, lesson_id)
)
--> statement-breakpoint
-- Real Exam timer truth lives on the server: started_at + duration = expires_at.
CREATE TABLE writing_exam_sessions (
 submission_id uuid PRIMARY KEY REFERENCES writing_submissions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 task_type writing_task_type NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 duration_seconds integer NOT NULL CHECK (duration_seconds IN (1200, 2400)),
 expires_at timestamptz NOT NULL,
 finalized_at timestamptz,
 CHECK (expires_at = started_at + make_interval(secs => duration_seconds))
)
--> statement-breakpoint
CREATE INDEX writing_exam_sessions_user_idx ON writing_exam_sessions (user_id, started_at DESC)
--> statement-breakpoint
-- Grade My Work: an immutable snapshot of the exact question and essay, saved
-- before any provider call. The evaluation row (evaluations, source_type
-- 'writing_grade') is the one authoritative result; analysis holds the
-- normalized W7 detail (never raw vendor JSON).
CREATE TABLE writing_grade_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 task_type writing_task_type NOT NULL,
 question_text text NOT NULL CHECK (char_length(question_text) BETWEEN 10 AND 4000),
 essay_text text NOT NULL CHECK (char_length(essay_text) BETWEEN 1 AND 20000),
 word_count integer NOT NULL CHECK (word_count >= 0),
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','evaluated','failed')),
 last_error varchar(60),
 -- Set while one request holds the provider call; a second caller sees it and
 -- does not call the provider again. Stale claims (> 3 minutes) may be retaken.
 claimed_at timestamptz,
 analysis jsonb,
 idempotency_key varchar(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 evaluated_at timestamptz
)
--> statement-breakpoint
CREATE UNIQUE INDEX writing_grade_requests_idem_idx ON writing_grade_requests (user_id, idempotency_key)
--> statement-breakpoint
CREATE INDEX writing_grade_requests_user_idx ON writing_grade_requests (user_id, created_at DESC)
--> statement-breakpoint
CREATE TABLE writing_translation_sets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title varchar(200) NOT NULL,
 topic varchar(120) NOT NULL,
 question_type varchar(30) NOT NULL CHECK (question_type IN ('opinion','discussion','problem_solution','advantages_disadvantages','two_part')),
 task_type writing_task_type NOT NULL DEFAULT 'task2',
 target_band smallint NOT NULL CHECK (target_band IN (6, 7, 8)),
 prompt_text text NOT NULL,
 provenance varchar(200) NOT NULL,
 publication_state publication_state NOT NULL DEFAULT 'draft',
 publish_at timestamptz,
 source_ref varchar(80),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
)
--> statement-breakpoint
CREATE UNIQUE INDEX writing_translation_sets_source_ref_idx ON writing_translation_sets (source_ref) WHERE source_ref IS NOT NULL
--> statement-breakpoint
CREATE TABLE writing_translation_sentences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 set_id uuid NOT NULL REFERENCES writing_translation_sets(id) ON DELETE CASCADE,
 position smallint NOT NULL CHECK (position BETWEEN 1 AND 40),
 uzbek_source text NOT NULL,
 model_english text NOT NULL,
 accepted_alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
 notes jsonb NOT NULL DEFAULT '[]'::jsonb,
 target_lexical_items jsonb NOT NULL DEFAULT '[]'::jsonb,
 UNIQUE (set_id, position)
)
--> statement-breakpoint
CREATE TABLE writing_translation_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 set_id uuid NOT NULL REFERENCES writing_translation_sets(id) ON DELETE CASCADE,
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 status varchar(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
 elapsed_ms integer,
 overall_estimate real,
 meaning_score real,
 grammar_band real,
 vocabulary_band real
)
--> statement-breakpoint
CREATE INDEX writing_translation_attempts_user_idx ON writing_translation_attempts (user_id, started_at DESC)
--> statement-breakpoint
CREATE TABLE writing_translation_answers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL REFERENCES writing_translation_attempts(id) ON DELETE CASCADE,
 sentence_id uuid NOT NULL REFERENCES writing_translation_sentences(id) ON DELETE CASCADE,
 answer_text text NOT NULL,
 evaluation_status varchar(20) NOT NULL CHECK (evaluation_status IN ('exact','evaluated','unavailable')),
 verdict varchar(20) CHECK (verdict IN ('correct','acceptable','needs_revision')),
 meaning_preserved smallint CHECK (meaning_preserved BETWEEN 0 AND 100),
 grammar_band real CHECK (grammar_band BETWEEN 0 AND 9),
 vocabulary_band real CHECK (vocabulary_band BETWEEN 0 AND 9),
 feedback text,
 improved_version text,
 tries smallint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (attempt_id, sentence_id)
)
--> statement-breakpoint
-- Typing uses complete authorized Band 8-9 model responses, never prompts.
CREATE TABLE writing_model_texts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title varchar(200) NOT NULL,
 task_type writing_task_type NOT NULL,
 topic varchar(120) NOT NULL,
 target_band numeric(2,1) NOT NULL CHECK (target_band BETWEEN 8 AND 9),
 body text NOT NULL CHECK (char_length(body) BETWEEN 200 AND 8000),
 word_count integer NOT NULL CHECK (word_count > 0),
 provenance varchar(200) NOT NULL,
 publication_state publication_state NOT NULL DEFAULT 'draft',
 publish_at timestamptz,
 source_ref varchar(80),
 created_at timestamptz NOT NULL DEFAULT now()
)
--> statement-breakpoint
CREATE UNIQUE INDEX writing_model_texts_source_ref_idx ON writing_model_texts (source_ref) WHERE source_ref IS NOT NULL
--> statement-breakpoint
CREATE TABLE typing_run_texts (
 run_id uuid PRIMARY KEY REFERENCES typing_runs(id) ON DELETE CASCADE,
 model_text_id uuid NOT NULL REFERENCES writing_model_texts(id) ON DELETE CASCADE,
 mistakes integer NOT NULL DEFAULT 0 CHECK (mistakes >= 0)
)
--> statement-breakpoint
CREATE TABLE writing_language_patterns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pattern varchar(240) NOT NULL,
 function varchar(30) NOT NULL CHECK (function IN ('collocation','sentence_frame','cohesion','comparison','concession','trend','argument')),
 task_type writing_task_type NOT NULL,
 topic varchar(120),
 target_band smallint CHECK (target_band BETWEEN 5 AND 9),
 example text NOT NULL CHECK (char_length(example) <= 400),
 usage_note text,
 provenance varchar(200) NOT NULL,
 publication_state publication_state NOT NULL DEFAULT 'draft',
 publish_at timestamptz,
 source_ref varchar(80),
 created_at timestamptz NOT NULL DEFAULT now()
)
--> statement-breakpoint
CREATE UNIQUE INDEX writing_language_patterns_source_ref_idx ON writing_language_patterns (source_ref) WHERE source_ref IS NOT NULL
--> statement-breakpoint
CREATE TABLE writing_pattern_bank (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 pattern_id uuid NOT NULL REFERENCES writing_language_patterns(id) ON DELETE CASCADE,
 saved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, pattern_id)
)
