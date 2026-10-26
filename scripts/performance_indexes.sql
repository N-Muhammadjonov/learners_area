-- Reviewed deployment candidate. Not executed by application startup or asset build.
-- Run outside a transaction after approval. Existing content and RLS stay intact.
CREATE INDEX CONCURRENTLY IF NOT EXISTS reading_attempts_user_started_perf ON reading_attempts(user_id,started_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS listening_attempts_user_started_perf ON listening_attempts(user_id,started_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS speaking_attempts_user_created_perf ON speaking_attempts(user_id,created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS writing_submissions_user_updated_perf ON writing_submissions(user_id,updated_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS evaluations_user_source_created_perf ON evaluations(user_id,source_type,created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS evaluations_user_created_perf ON evaluations(user_id,created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS lesson_progress_user_perf ON lesson_progress(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS mock_attempts_user_started_perf ON mock_attempts(user_id,started_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS activity_events_user_created_perf ON activity_events(user_id,created_at DESC);
