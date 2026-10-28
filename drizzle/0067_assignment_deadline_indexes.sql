-- Keep lazy deadline notification reconciliation bounded for each learner.
CREATE INDEX IF NOT EXISTS assignments_target_due_idx
  ON assignments (target_user_id, due_at)
  WHERE target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS assignment_targets_student_due_idx
  ON assignment_targets (student_user_id, due_at)
  WHERE status <> 'completed';
