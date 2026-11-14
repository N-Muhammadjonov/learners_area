CREATE TABLE IF NOT EXISTS academy_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES academy_groups(id),
    series_id uuid NOT NULL,
    branch varchar(120) NOT NULL,
    room varchar(120) NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    status varchar(12) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'held', 'cancelled', 'rescheduled')),
    replaces_id uuid UNIQUE REFERENCES academy_sessions(id),
    reason varchar(300),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    UNIQUE (series_id, starts_at)
);
CREATE INDEX IF NOT EXISTS academy_sessions_group_start_idx ON academy_sessions(group_id, starts_at, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS academy_session_teachers (
    session_id uuid NOT NULL REFERENCES academy_sessions(id),
    teacher_user_id uuid NOT NULL REFERENCES users(id),
    PRIMARY KEY (session_id, teacher_user_id)
);
CREATE INDEX IF NOT EXISTS academy_session_teachers_scope_idx
    ON academy_session_teachers(teacher_user_id, session_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS academy_session_reservations (
    session_id uuid NOT NULL REFERENCES academy_sessions(id),
    resource_key text NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
    PRIMARY KEY (session_id, resource_key)
);
CREATE INDEX IF NOT EXISTS academy_session_reservations_overlap_idx
    ON academy_session_reservations(resource_key, starts_at, ends_at);
--> statement-breakpoint
ALTER TABLE academy_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_session_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_session_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academy_sessions, academy_session_teachers, academy_session_reservations FROM PUBLIC;
DO $academy_session_access$
DECLARE api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON academy_sessions, academy_session_teachers, academy_session_reservations FROM %I', api_role);
        END IF;
    END LOOP;
END $academy_session_access$;
