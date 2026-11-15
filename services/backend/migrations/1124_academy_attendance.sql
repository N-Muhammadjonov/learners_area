ALTER TABLE academy_group_memberships ADD COLUMN IF NOT EXISTS activated_on date;
UPDATE academy_group_memberships
   SET activated_on=starts_on
 WHERE activated_on IS NULL AND (status IN ('active','paused','completed','transferred')
    OR (status='withdrawn' AND EXISTS (
        SELECT 1 FROM audit_log WHERE action='academy.group.membership_updated'
          AND metadata->>'membershipId'=academy_group_memberships.id::text
          AND metadata->>'from' IN ('active','paused'))));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS academy_attendance (
    session_id uuid NOT NULL REFERENCES academy_sessions(id),
    membership_id uuid NOT NULL REFERENCES academy_group_memberships(id) ON DELETE CASCADE,
    student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status varchar(12) NOT NULL DEFAULT 'not_marked'
      CHECK (status IN ('not_marked','present','late','absent','excused')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
    marked_by uuid REFERENCES users(id) ON DELETE SET NULL,
    marked_at timestamptz,
    PRIMARY KEY (session_id, student_user_id),
    CHECK ((marked_at IS NULL) = (status='not_marked'))
);
CREATE INDEX IF NOT EXISTS academy_attendance_student_idx ON academy_attendance(student_user_id, session_id);
--> statement-breakpoint
ALTER TABLE academy_attendance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academy_attendance FROM PUBLIC;
DO $academy_attendance_access$
DECLARE api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON academy_attendance FROM %I', api_role);
        END IF;
    END LOOP;
END $academy_attendance_access$;
