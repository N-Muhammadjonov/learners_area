-- Per-learner provider telemetry. Authored video content and completion rules stay authoritative.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.video_lesson_progress
  ADD COLUMN IF NOT EXISTS playback_duration_seconds integer
  CHECK (playback_duration_seconds BETWEEN 1 AND 43200);
COMMENT ON COLUMN public.video_lesson_progress.playback_duration_seconds IS
  'Learner-scoped provider duration for display when the authored video has no duration. Does not decide completion.';
