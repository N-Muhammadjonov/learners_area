-- Explicit teacher -> student roster for RIWI Reporter teacher scoping.
-- Additive only: one new table, no existing row is read, changed or back-filled.
-- No link is inferred from assignments or live-class history: a teacher sees a
-- learner in reports ONLY after an owner/admin explicitly assigns them here.
-- Rollback/recovery: dropping this table removes only roster links; teachers then
-- see zero learners in Reporter (fail closed). No learner data depends on it.
CREATE TABLE IF NOT EXISTS teacher_student_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_student_links_distinct CHECK (teacher_user_id <> student_user_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS teacher_student_links_pair_uidx ON teacher_student_links (teacher_user_id, student_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS teacher_student_links_student_idx ON teacher_student_links (student_user_id);
