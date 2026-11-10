-- The FastAPI service owns these rows. The Supabase Data API has no grants.
CREATE TABLE study_plan_preferences (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    weekdays smallint[] NOT NULL,
    timezone text NOT NULL,
    preferred_time time,
    focus_skills text[] NOT NULL DEFAULT '{}',
    skill_targets jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revised_on date,
    validated_at timestamptz,
    revision integer NOT NULL DEFAULT 0,
    revision_reason text NOT NULL DEFAULT 'setup',
    CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
    CHECK (focus_skills <@ ARRAY['reading','listening','writing','speaking']::text[])
);

CREATE TABLE study_plan_tasks (
    user_id uuid NOT NULL REFERENCES study_plan_preferences(user_id) ON DELETE CASCADE,
    task_key text NOT NULL,
    source_key text NOT NULL,
    skill text NOT NULL,
    title text NOT NULL,
    href text NOT NULL,
    reason text NOT NULL,
    minutes smallint NOT NULL CHECK (minutes BETWEEN 1 AND 300),
    priority smallint NOT NULL,
    state text NOT NULL CHECK (state IN ('planned','in_progress')),
    planned_on date NOT NULL,
    original_on date NOT NULL,
    pinned boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    retired_at timestamptz,
    PRIMARY KEY (user_id, task_key)
);
CREATE INDEX study_plan_task_days ON study_plan_tasks (user_id, planned_on);
CREATE INDEX study_plan_task_pending ON study_plan_tasks (user_id, source_key) WHERE completed_at IS NULL AND retired_at IS NULL;

CREATE TABLE study_reward_ledger (
    user_id uuid NOT NULL REFERENCES study_plan_preferences(user_id) ON DELETE CASCADE,
    event_key text NOT NULL,
    points smallint NOT NULL CHECK (points > 0),
    earned_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, event_key)
);
CREATE INDEX study_reward_period ON study_reward_ledger (user_id, earned_at);

CREATE TABLE study_reward_purchases (
    user_id uuid NOT NULL REFERENCES study_plan_preferences(user_id) ON DELETE CASCADE,
    item_key text NOT NULL,
    points smallint NOT NULL CHECK (points > 0),
    purchased_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_key)
);

CREATE TABLE study_leaderboard_participants (
    user_id uuid PRIMARY KEY REFERENCES study_plan_preferences(user_id) ON DELETE CASCADE,
    alias text NOT NULL CHECK (length(alias) BETWEEN 3 AND 24),
    joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE study_plan_shares (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES study_plan_preferences(user_id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    snapshot jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX study_plan_shares_owner ON study_plan_shares (user_id, created_at DESC);

-- Keep the latest grading evidence separate from a mutable Reading draft.
CREATE TABLE study_reading_practice_evidence (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    passage_id uuid NOT NULL REFERENCES reading_passages(id) ON DELETE CASCADE,
    scores jsonb NOT NULL,
    checked_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, passage_id)
);
CREATE INDEX study_reading_practice_by_user ON study_reading_practice_evidence (user_id, checked_at DESC);

ALTER TABLE study_plan_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plan_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_reward_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_reward_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_leaderboard_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plan_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_reading_practice_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON study_plan_preferences, study_plan_tasks, study_reward_ledger, study_reward_purchases,
    study_leaderboard_participants, study_plan_shares, study_reading_practice_evidence FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON study_plan_preferences, study_plan_tasks, study_reward_ledger,
          study_reward_purchases, study_leaderboard_participants, study_plan_shares, study_reading_practice_evidence FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
