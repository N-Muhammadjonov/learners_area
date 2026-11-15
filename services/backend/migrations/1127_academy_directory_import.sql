CREATE TABLE IF NOT EXISTS academy_directory_imports (
    id uuid PRIMARY KEY,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    source varchar(80) NOT NULL,
    fingerprint varchar(64) NOT NULL,
    file_sha256 varchar(64) NOT NULL,
    report jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS academy_directory_records (
    source varchar(80) NOT NULL,
    external_id varchar(120) NOT NULL,
    name varchar(200) NOT NULL,
    email varchar(320),
    role varchar(12) NOT NULL CHECK (role IN ('student','teacher')),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    created_in uuid NOT NULL REFERENCES academy_directory_imports(id),
    linked_in uuid REFERENCES academy_directory_imports(id),
    PRIMARY KEY (source, external_id),
    CHECK (linked_in IS NULL OR user_id IS NOT NULL),
    CHECK (email IS NOT NULL OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS academy_directory_records_source_email_idx
    ON academy_directory_records(source, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS academy_directory_records_source_user_idx
    ON academy_directory_records(source, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS academy_directory_records_user_idx
    ON academy_directory_records(user_id) WHERE user_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE academy_directory_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_directory_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academy_directory_imports, academy_directory_records FROM PUBLIC;
DO $academy_directory_access$
DECLARE api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON academy_directory_imports, academy_directory_records FROM %I', api_role);
        END IF;
    END LOOP;
END $academy_directory_access$;
