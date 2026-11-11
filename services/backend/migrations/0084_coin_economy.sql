-- Coin economy. Apply manually on the production database. The app does not run this file.
-- Existing study_reward_ledger rows stay legacy points. Coins are a separate wallet so
-- spending points, old ranks and purchased cosmetics are unchanged.
-- effective_at is the moment this migration is applied: earlier completions are not backfilled.

CREATE TABLE IF NOT EXISTS coin_policy (
    version text PRIMARY KEY,
    effective_at timestamptz NOT NULL,
    rules jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO coin_policy(version, effective_at, rules)
VALUES ('coin-economy-v1', now(), '{"unit":"coin","exercise":1,"activeMinutes":5}'::jsonb)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS coin_ledger (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_key text NOT NULL,
    coins smallint NOT NULL CHECK (coins BETWEEN 1 AND 6),
    earned_at timestamptz NOT NULL DEFAULT now(),
    module text NOT NULL,
    activity_type text NOT NULL,
    parent_content_id text,
    exercise_id text,
    content_revision text,
    evidence_id text,
    policy_version text NOT NULL DEFAULT 'coin-economy-v1',
    PRIMARY KEY (user_id, event_key)
);
CREATE INDEX IF NOT EXISTS coin_ledger_period ON coin_ledger (earned_at, user_id);
CREATE INDEX IF NOT EXISTS coin_ledger_module_day ON coin_ledger (user_id, module, earned_at);

CREATE TABLE IF NOT EXISTS coin_spend (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spend_key text NOT NULL,
    coins smallint NOT NULL CHECK (coins > 0),
    spent_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, spend_key)
);

CREATE TABLE IF NOT EXISTS coin_practice_time (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module text NOT NULL,
    active_ms integer NOT NULL CHECK (active_ms BETWEEN 1 AND 60000),
    earned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coin_practice_period ON coin_practice_time (earned_at, user_id);

CREATE TABLE IF NOT EXISTS coin_media_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id text NOT NULL CHECK (char_length(media_id) BETWEEN 1 AND 80),
    module text NOT NULL CHECK (module IN ('ted', 'podcast', 'speaking')),
    last_at timestamptz NOT NULL DEFAULT now(),
    last_position_ms integer NOT NULL CHECK (last_position_ms >= 0),
    credited_ms integer NOT NULL DEFAULT 0 CHECK (credited_ms >= 0)
);
CREATE INDEX IF NOT EXISTS coin_media_sessions_owner ON coin_media_sessions (user_id, media_id);

CREATE TABLE IF NOT EXISTS coin_media_coverage (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id text NOT NULL,
    bucket integer NOT NULL,
    credited_ms integer NOT NULL DEFAULT 0 CHECK (credited_ms >= 0),
    paid boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, media_id, bucket)
);

CREATE TABLE IF NOT EXISTS grammar_book_evidence (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_key text NOT NULL,
    level text NOT NULL,
    unit_id text NOT NULL,
    stage smallint NOT NULL,
    exercise smallint NOT NULL,
    answer_count smallint NOT NULL,
    content_kind text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, event_key)
);

ALTER TABLE coin_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_practice_time ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_media_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_media_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE grammar_book_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON coin_policy, coin_ledger, coin_spend, coin_practice_time,
    coin_media_sessions, coin_media_coverage, grammar_book_evidence FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON coin_policy, coin_ledger, coin_spend, coin_practice_time,
          coin_media_sessions, coin_media_coverage, grammar_book_evidence FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
