CREATE TABLE IF NOT EXISTS academy_rescue_cases (
    group_id uuid NOT NULL REFERENCES academy_groups(id),
    student_id uuid NOT NULL REFERENCES users(id),
    revision integer NOT NULL CHECK (revision > 0),
    status varchar(12) NOT NULL CHECK (status IN ('open','claimed','follow_up','resolved','dismissed')),
    assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
    follow_up_on date,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, student_id)
);
CREATE TABLE IF NOT EXISTS academy_rescue_actions (
    id uuid PRIMARY KEY,
    group_id uuid NOT NULL,
    student_id uuid NOT NULL,
    actor_id uuid NOT NULL REFERENCES users(id),
    revision integer NOT NULL CHECK (revision > 0),
    action varchar(12) NOT NULL CHECK (action IN ('claim','assign','note','plan','follow_up','resolve','dismiss','reopen')),
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 300),
    body_hash varchar(64) NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (group_id, student_id) REFERENCES academy_rescue_cases(group_id, student_id),
    UNIQUE (group_id, student_id, revision)
);
--> statement-breakpoint
ALTER TABLE academy_rescue_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_rescue_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academy_rescue_cases, academy_rescue_actions FROM PUBLIC;
DO $academy_rescue_access$
DECLARE api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON academy_rescue_cases, academy_rescue_actions FROM %I', api_role);
        END IF;
    END LOOP;
END $academy_rescue_access$;
