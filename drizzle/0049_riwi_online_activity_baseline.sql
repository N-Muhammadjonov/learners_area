-- Existing last_active_at values were not maintained by authenticated site use.
-- Start the seven-day offline clock at rollout rather than deleting active users' chats.
-- Apply once through the migration journal before enabling the new retention job.
UPDATE users SET last_active_at = greatest(last_active_at, now());
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_online_activity_idx ON users (last_active_at, id);
