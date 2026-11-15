CREATE TABLE IF NOT EXISTS academy_rescue_thresholds (
    id smallint PRIMARY KEY CHECK (id = 1),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    window_days integer NOT NULL DEFAULT 28 CHECK (window_days BETWEEN 7 AND 90),
    attendance_percent integer NOT NULL DEFAULT 75 CHECK (attendance_percent BETWEEN 1 AND 100),
    minimum_marked_sessions integer NOT NULL DEFAULT 3 CHECK (minimum_marked_sessions BETWEEN 2 AND 20),
    overdue_streak integer NOT NULL DEFAULT 2 CHECK (overdue_streak BETWEEN 1 AND 10),
    score_drop_points integer NOT NULL DEFAULT 15 CHECK (score_drop_points BETWEEN 1 AND 100),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO academy_rescue_thresholds(id) VALUES(1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE academy_rescue_thresholds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academy_rescue_thresholds FROM PUBLIC;
DO $academy_rescue_access$
DECLARE api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON academy_rescue_thresholds FROM %I', api_role);
        END IF;
    END LOOP;
END $academy_rescue_access$;
