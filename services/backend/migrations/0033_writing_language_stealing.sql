-- 0033 Language Stealing 7-step workflow. Additive only: one NEW table; no existing rows touched.
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
