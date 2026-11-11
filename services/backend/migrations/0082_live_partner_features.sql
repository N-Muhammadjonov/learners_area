CREATE TABLE live_partner_queue (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    gender text NOT NULL CHECK (gender IN ('any', 'male', 'female')),
    level text NOT NULL CHECK (level IN ('any', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
    joined_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE TABLE live_partner_friends (
    user_a uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted_at timestamptz,
    PRIMARY KEY (user_a, user_b),
    CHECK (user_a < user_b AND requested_by IN (user_a, user_b))
);
CREATE INDEX live_partner_friends_user_b_idx ON live_partner_friends(user_b);

CREATE TABLE live_partner_feedback (
    session_id uuid NOT NULL REFERENCES live_partner_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('rating', 'report')),
    rating smallint,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, user_id, kind),
    CHECK (
        (kind = 'rating' AND rating IS NOT NULL AND rating BETWEEN 1 AND 5 AND reason IS NULL)
        OR (kind = 'report' AND rating IS NULL AND reason IN ('abuse', 'spam', 'other') AND reason IS NOT NULL)
    )
);

CREATE TABLE live_partner_activities (
    session_id uuid PRIMARY KEY REFERENCES live_partner_sessions(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version > 0),
    content jsonb NOT NULL,
    last_mock jsonb,
    updated_at timestamptz NOT NULL
);
CREATE INDEX live_partner_sessions_history_a_idx ON live_partner_sessions(user_a, ended_at DESC)
    WHERE connected_at IS NOT NULL AND ended_at IS NOT NULL;
CREATE INDEX live_partner_sessions_history_b_idx ON live_partner_sessions(user_b, ended_at DESC)
    WHERE connected_at IS NOT NULL AND ended_at IS NOT NULL;

DO $$
DECLARE table_name text;
DECLARE api_role text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['live_partner_queue','live_partner_friends','live_partner_feedback','live_partner_activities'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
        FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
                EXECUTE format('REVOKE ALL ON %I FROM %I', table_name, api_role);
            END IF;
        END LOOP;
    END LOOP;
END $$;
