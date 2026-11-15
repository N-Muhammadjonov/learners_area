-- Rescue reads each learner's completed attempts inside a lateral join.
-- Keep the lookup bounded by learner and submission window as history grows.
CREATE INDEX IF NOT EXISTS reading_attempts_completed_user_submitted_idx
    ON reading_attempts (user_id, submitted_at)
    WHERE status = 'completed' AND submitted_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS listening_attempts_completed_user_submitted_idx
    ON listening_attempts (user_id, submitted_at)
    WHERE status = 'completed' AND submitted_at IS NOT NULL;
--> statement-breakpoint
-- Timeline includes historic memberships, including rows with an end date.
CREATE INDEX IF NOT EXISTS academy_group_memberships_activated_student_idx
    ON academy_group_memberships (student_user_id)
    WHERE activated_on IS NOT NULL;
