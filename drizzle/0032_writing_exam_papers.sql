-- 0032 Real Exam papers (Task 1 / Task 2 / Full Writing).
-- Additive only: two NEW tables + one nullable column on writing_grade_requests. 0031's writing_exam_sessions (one submission,
-- 1200/2400 s) is left untouched and stays valid; it cannot represent a 60-min
-- paper holding two tasks, so Real Exam uses this parent/child model instead.
-- One paper = one server deadline (started_at + duration = expires_at) shared
-- by its one (task1 | task2) or two (full: task1 + task2) entries, each backed
-- by its own writing_submissions draft. No rows are seeded or modified.
CREATE TABLE writing_exam_papers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mode varchar(8) NOT NULL CHECK (mode IN ('task1', 'task2', 'full')),
 started_at timestamptz NOT NULL DEFAULT now(),
 duration_seconds integer NOT NULL,
 expires_at timestamptz NOT NULL,
 finalized_at timestamptz,
 finalize_reason varchar(12) CHECK (finalize_reason IN ('submitted', 'timeout', 'abandoned')),
 CHECK ((mode = 'task1' AND duration_seconds = 1200) OR (mode = 'task2' AND duration_seconds = 2400) OR (mode = 'full' AND duration_seconds = 3600)),
 CHECK (expires_at = started_at + make_interval(secs => duration_seconds)),
 CHECK ((finalized_at IS NULL) = (finalize_reason IS NULL))
)
--> statement-breakpoint
CREATE INDEX writing_exam_papers_user_idx ON writing_exam_papers (user_id, started_at DESC)
--> statement-breakpoint
-- At most one open paper per learner: a second Start resumes it instead of
-- minting a fresh deadline (refresh / double-click cannot buy extra time).
CREATE UNIQUE INDEX writing_exam_papers_one_open_idx ON writing_exam_papers (user_id) WHERE finalized_at IS NULL
--> statement-breakpoint
CREATE TABLE writing_exam_paper_entries (
 paper_id uuid NOT NULL REFERENCES writing_exam_papers(id) ON DELETE CASCADE,
 position smallint NOT NULL CHECK (position IN (1, 2)),
 task_type writing_task_type NOT NULL,
 prompt_id uuid NOT NULL REFERENCES writing_prompts(id),
 submission_id uuid NOT NULL UNIQUE REFERENCES writing_submissions(id) ON DELETE CASCADE,
 -- Monotonic autosave revision: an older, late-arriving save never overwrites a newer one.
 draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
 saved_at timestamptz,
 PRIMARY KEY (paper_id, position),
 UNIQUE (paper_id, task_type)
)
--> statement-breakpoint
-- Grade My Work Task 1 visual: an optional link to the published prompt whose
-- chart/map/process the learner answered (Learners Area-owned material only).
-- Nullable, additive; every existing 0031 row stays valid with NULL.
ALTER TABLE writing_grade_requests ADD COLUMN prompt_id uuid REFERENCES writing_prompts(id) ON DELETE SET NULL

--> statement-breakpoint
-- Language Stealing 7-step workflow (one row per learner per authorized model
-- text; resumable). Additive NEW table; the Day-3 rewrite unlock time is server-held.
CREATE TABLE writing_stealing_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model_text_id uuid NOT NULL REFERENCES writing_model_texts(id) ON DELETE CASCADE,
 step smallint NOT NULL DEFAULT 1 CHECK (step BETWEEN 1 AND 7),
 brainstorm text,
 draft text,
 selected_pattern_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 comparison text,
 memorised_pattern_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 rewrite_available_at timestamptz,
 rewrite text,
 rewrite_pattern_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, model_text_id)
)
