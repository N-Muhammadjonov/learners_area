CREATE TABLE study_plan_months (
    user_id uuid PRIMARY KEY REFERENCES study_plan_preferences(user_id) ON DELETE CASCADE,
    attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),
    listening jsonb NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    assessed_at timestamptz,
    started_on date,
    revised_on date,
    diagnosis jsonb,
    schedule jsonb,
    CHECK (
        (assessed_at IS NULL AND started_on IS NULL AND revised_on IS NULL AND diagnosis IS NULL AND schedule IS NULL)
        OR
        (assessed_at IS NOT NULL AND started_on IS NOT NULL AND revised_on IS NOT NULL AND diagnosis IS NOT NULL AND schedule IS NOT NULL)
    )
);

ALTER TABLE study_plan_months ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON study_plan_months FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON study_plan_months FROM %I', api_role);
        END IF;
    END LOOP;
END $$;
