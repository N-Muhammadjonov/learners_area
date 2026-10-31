-- Phase 2: Additive schema for YouTube Live Classes, class enrollments, native live chat,
-- recording lifecycle metadata, and estimated page attendance tracking.
-- Preserves all existing tables, enum values, and historical attendance data without destructive loss.

ALTER TABLE public.live_classes
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS youtube_video_id varchar(11),
  ADD COLUMN IF NOT EXISTS recording_status varchar(32) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS recording_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS access_scope varchar(24) NOT NULL DEFAULT 'course',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_classes_youtube_video_id_chk'
  ) THEN
    ALTER TABLE public.live_classes
      ADD CONSTRAINT live_classes_youtube_video_id_chk
      CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_classes_recording_status_chk'
  ) THEN
    ALTER TABLE public.live_classes
      ADD CONSTRAINT live_classes_recording_status_chk
      CHECK (recording_status IN ('none', 'processing', 'ready', 'unavailable'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_classes_recording_duration_chk'
  ) THEN
    ALTER TABLE public.live_classes
      ADD CONSTRAINT live_classes_recording_duration_chk
      CHECK (recording_duration_seconds IS NULL OR (recording_duration_seconds > 0 AND recording_duration_seconds <= 86400));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_classes_access_scope_chk'
  ) THEN
    ALTER TABLE public.live_classes
      ADD CONSTRAINT live_classes_access_scope_chk
      CHECK (access_scope IN ('course', 'teacher_roster', 'assigned'));
  END IF;
END $$;

-- Backfill recording_status='ready' for any legacy rows that already have status='recorded'
UPDATE public.live_classes
SET recording_status = 'ready'
WHERE status = 'recorded' AND recording_status = 'none';

CREATE INDEX IF NOT EXISTS live_classes_course_status_sched_idx
  ON public.live_classes (course_id, status, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS live_classes_teacher_sched_idx
  ON public.live_classes (teacher_user_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS live_classes_recording_ready_idx
  ON public.live_classes (course_id, recording_status, scheduled_at DESC);

-- Class access mapping for lessons restricted to specific students
CREATE TABLE IF NOT EXISTS public.live_class_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_class_id uuid NOT NULL REFERENCES public.live_classes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS live_class_enrollments_class_user_uidx
  ON public.live_class_enrollments (live_class_id, user_id);

CREATE INDEX IF NOT EXISTS live_class_enrollments_user_idx
  ON public.live_class_enrollments (user_id, live_class_id);

-- Learners Area native live class chat messages
CREATE TABLE IF NOT EXISTS public.live_class_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_class_id uuid NOT NULL REFERENCES public.live_classes(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_class_messages_body_chk CHECK (char_length(btrim(body)) >= 1 AND char_length(body) <= 500)
);

CREATE INDEX IF NOT EXISTS live_class_messages_class_created_idx
  ON public.live_class_messages (live_class_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS live_class_messages_sender_created_idx
  ON public.live_class_messages (sender_user_id, created_at DESC);

-- Additive attendance tracking columns (join, heartbeat/last_seen, leave, estimated duration, session history)
ALTER TABLE public.live_class_attendance
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS left_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_duration_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS session_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active_sessions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Non-destructive consolidation of duplicate (live_class_id, user_id) rows BEFORE setting last_seen_at NOT NULL:
-- 1. Collects historical attendance intervals per (live_class_id, user_id) sorted by joined_at ASC.
-- 2. Merges overlapping intervals and intervals separated by <= 5 seconds into a single distinct session.
-- 3. Calculates total duration from the union of actual covered intervals (never double-counting overlap,
--    never counting short gaps, and never fabricating duration for incomplete legacy records).
-- 4. Preserves every entry of pre-existing session_history arrays from ALL duplicate rows,
--    including rows that will be removed, followed by that row's original snapshot.
--    History values are carried through unchanged (including nested JSON and JSON null).
-- 5. Preserves earliest joined_at and latest last_seen_at / left_at before deleting redundant secondary rows.
DO $$ BEGIN
  WITH base_rows AS (
    SELECT
      id,
      live_class_id,
      user_id,
      joined_at,
      last_seen_at AS raw_last_seen_at,
      left_at,
      GREATEST(0, COALESCE(estimated_duration_seconds, 0)) AS recorded_duration_seconds,
      GREATEST(1, COALESCE(session_count, 1)) AS row_session_count,
      (last_seen_at IS NULL AND left_at IS NULL AND COALESCE(estimated_duration_seconds, 0) <= 0) AS is_incomplete,
      GREATEST(
        joined_at,
        COALESCE(last_seen_at, joined_at),
        COALESCE(left_at, joined_at),
        joined_at + (GREATEST(0, COALESCE(estimated_duration_seconds, 0)) * INTERVAL '1 second')
      ) AS effective_end_at,
      CASE
        WHEN COALESCE(estimated_duration_seconds, 0) > 0 THEN
          joined_at + (GREATEST(0, COALESCE(estimated_duration_seconds, 0)) * INTERVAL '1 second')
        ELSE
          GREATEST(
            joined_at,
            COALESCE(last_seen_at, joined_at),
            COALESCE(left_at, joined_at)
          )
      END AS dur_end_at,
      session_history
    FROM public.live_class_attendance
  ),
  ordered_rows AS (
    SELECT
      b.*,
      ROW_NUMBER() OVER (
        PARTITION BY live_class_id, user_id
        ORDER BY joined_at ASC, effective_end_at ASC, id::text ASC
      ) AS rn,
      COUNT(*) OVER (
        PARTITION BY live_class_id, user_id
      ) AS group_size,
      MAX(effective_end_at) OVER (
        PARTITION BY live_class_id, user_id
        ORDER BY joined_at ASC, effective_end_at ASC, id::text ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS prev_max_session_end_at,
      MAX(dur_end_at) OVER (
        PARTITION BY live_class_id, user_id
        ORDER BY joined_at ASC, dur_end_at ASC, id::text ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS prev_max_dur_end_at
    FROM base_rows b
  ),
  duplicate_groups AS (
    SELECT
      o.*,
      CASE
        WHEN o.rn = 1 THEN o.row_session_count
        WHEN o.prev_max_session_end_at IS NULL THEN o.row_session_count
        WHEN o.joined_at > o.prev_max_session_end_at + INTERVAL '5 seconds' THEN o.row_session_count
        ELSE 0
      END AS distinct_session_increment,
      CASE
        WHEN o.dur_end_at <= o.joined_at THEN 0
        WHEN o.prev_max_dur_end_at IS NULL OR o.joined_at >= o.prev_max_dur_end_at THEN
          ROUND(EXTRACT(EPOCH FROM (o.dur_end_at - o.joined_at)))::integer
        WHEN o.dur_end_at <= o.prev_max_dur_end_at THEN 0
        ELSE
          GREATEST(0, ROUND(EXTRACT(EPOCH FROM (o.dur_end_at - o.prev_max_dur_end_at)))::integer)
      END AS non_overlapping_duration_seconds
    FROM ordered_rows o
    WHERE o.group_size > 1
  ),
  -- Flatten pre-existing JSONB arrays from *each* duplicate record, not only the keeper.
  -- WITH ORDINALITY retains each array's original element order. Per-row snapshots are
  -- placed after that row's existing history, matching the reference consolidation.
  history_items AS (
    SELECT
      o.live_class_id, o.user_id, o.rn,
      0 AS source_order, h.ordinality AS entry_order, h.entry
    FROM duplicate_groups o
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(o.session_history) = 'array' THEN o.session_history
        -- A legacy row may contain a non-array JSONB value; never discard it.
        WHEN o.session_history IS NOT NULL THEN jsonb_build_array(o.session_history)
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS h(entry, ordinality)
    UNION ALL
    SELECT
      o.live_class_id, o.user_id, o.rn,
      1 AS source_order, 0::bigint AS entry_order,
      JSONB_BUILD_OBJECT(
        'id', o.id,
        'joinedAt', o.joined_at,
        'lastSeenAt', o.raw_last_seen_at,
        'effectiveEndAt', o.effective_end_at,
        'leftAt', o.left_at,
        'estimatedDurationSeconds', o.recorded_duration_seconds,
        'sessionCount', o.row_session_count,
        'incomplete', o.is_incomplete
      ) AS entry
    FROM duplicate_groups o
  ),
  consolidated_history AS (
    SELECT live_class_id, user_id,
      JSONB_AGG(entry ORDER BY rn, source_order, entry_order) AS full_history
    FROM history_items
    GROUP BY live_class_id, user_id
  ),
  consolidated AS (
    SELECT
      live_class_id,
      user_id,
      (ARRAY_AGG(id ORDER BY rn ASC))[1] AS keep_id,
      MIN(joined_at) AS min_joined_at,
      MAX(effective_end_at) AS max_last_seen_at,
      (ARRAY_AGG(left_at ORDER BY effective_end_at DESC, rn DESC))[1] AS latest_left_at,
      LEAST(86400, SUM(non_overlapping_duration_seconds)::integer) AS total_duration_seconds,
      GREATEST(1, SUM(distinct_session_increment)::integer) AS total_sessions
    FROM duplicate_groups
    GROUP BY live_class_id, user_id
  ),
  updated_keepers AS (
    UPDATE public.live_class_attendance target
    SET
      joined_at = c.min_joined_at,
      last_seen_at = c.max_last_seen_at,
      left_at = c.latest_left_at,
      estimated_duration_seconds = c.total_duration_seconds,
      session_count = c.total_sessions,
      -- All historical arrays and all original row snapshots were collected
      -- before any secondary rows are deleted. Never read history only from target.
      session_history = h.full_history
    FROM consolidated c
    JOIN consolidated_history h
      ON h.live_class_id = c.live_class_id AND h.user_id = c.user_id
    WHERE target.id = c.keep_id
    RETURNING target.id, target.live_class_id, target.user_id
  )
  DELETE FROM public.live_class_attendance d
  USING updated_keepers k
  WHERE d.live_class_id = k.live_class_id
    AND d.user_id = k.user_id
    AND d.id <> k.id;
END $$;

-- Backfill last_seen_at = joined_at on any remaining rows where last_seen_at is still NULL
UPDATE public.live_class_attendance
SET last_seen_at = joined_at
WHERE last_seen_at IS NULL;

ALTER TABLE public.live_class_attendance
  ALTER COLUMN last_seen_at SET DEFAULT now(),
  ALTER COLUMN last_seen_at SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_class_attendance_duration_chk'
  ) THEN
    ALTER TABLE public.live_class_attendance
      ADD CONSTRAINT live_class_attendance_duration_chk
      CHECK (estimated_duration_seconds >= 0 AND estimated_duration_seconds <= 86400);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'live_class_attendance_sessions_chk'
  ) THEN
    ALTER TABLE public.live_class_attendance
      ADD CONSTRAINT live_class_attendance_sessions_chk
      CHECK (session_count >= 1);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS live_class_attendance_class_user_uidx
  ON public.live_class_attendance (live_class_id, user_id);

CREATE INDEX IF NOT EXISTS live_class_attendance_user_joined_idx
  ON public.live_class_attendance (user_id, joined_at DESC);

ALTER TABLE public.live_class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_class_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_class_enrollments FROM PUBLIC;
REVOKE ALL ON public.live_class_messages FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.live_class_enrollments FROM anon;
    REVOKE ALL ON public.live_class_messages FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.live_class_enrollments FROM authenticated;
    REVOKE ALL ON public.live_class_messages FROM authenticated;
  END IF;
END $$;
