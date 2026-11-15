-- Course enrolments grant curriculum access. These tables track operational cohorts.
CREATE TABLE IF NOT EXISTS academy_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id uuid NOT NULL REFERENCES courses(id),
    name varchar(120) NOT NULL CHECK (btrim(name) <> ''),
    branch varchar(120) NOT NULL CHECK (btrim(branch) <> ''),
    room varchar(120),
    fee_plan_label varchar(120),
    capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
    starts_on date NOT NULL,
    ends_on date CHECK (ends_on >= starts_on),
    status varchar(12) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'completed', 'archived')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    UNIQUE (id, course_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS academy_groups_course_idx ON academy_groups(course_id);
CREATE INDEX IF NOT EXISTS academy_groups_status_name_idx ON academy_groups(status, lower(name), id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS academy_group_teachers (
    group_id uuid NOT NULL REFERENCES academy_groups(id) ON DELETE CASCADE,
    teacher_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, teacher_user_id)
);
CREATE INDEX IF NOT EXISTS academy_group_teachers_scope_idx
    ON academy_group_teachers(teacher_user_id, group_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS academy_group_memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL,
    course_id uuid NOT NULL,
    student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_on date NOT NULL,
    ends_on date CHECK (ends_on >= starts_on),
    status varchar(12) NOT NULL CHECK (status IN
        ('pending', 'active', 'paused', 'completed', 'withdrawn', 'transferred')),
    transferred_from_id uuid UNIQUE REFERENCES academy_group_memberships(id) ON DELETE SET NULL,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    FOREIGN KEY (group_id, course_id) REFERENCES academy_groups(id, course_id),
    CHECK ((ends_on IS NULL) = (status IN ('pending', 'active', 'paused')))
);
CREATE UNIQUE INDEX IF NOT EXISTS academy_group_memberships_current_idx
    ON academy_group_memberships(student_user_id, course_id)
    WHERE ends_on IS NULL;
CREATE INDEX IF NOT EXISTS academy_group_memberships_roster_idx
    ON academy_group_memberships(group_id, starts_on DESC, id DESC);
CREATE INDEX IF NOT EXISTS academy_group_memberships_seat_idx
    ON academy_group_memberships(group_id) WHERE status IN ('active', 'paused');
--> statement-breakpoint
ALTER TABLE academy_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_group_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_group_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academy_groups, academy_group_teachers, academy_group_memberships FROM PUBLIC;
DO $academy_access$
DECLARE api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON academy_groups, academy_group_teachers, academy_group_memberships FROM %I', api_role);
        END IF;
    END LOOP;
END $academy_access$;
