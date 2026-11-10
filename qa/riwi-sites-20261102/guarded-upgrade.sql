-- QA-only guarded upgrade. One DO statement is atomic even without a client transaction.
-- Requires the verified private recovery snapshot. No production connection is used.
DO $riwi_qa_upgrade_8054d759$
DECLARE item record; omitted text[]; row_count_now bigint; digest_now text;
BEGIN
  PERFORM set_config('lock_timeout','3s',true);
  IF (SELECT count(*) FROM public.users)<>1 OR NOT EXISTS
    (SELECT 1 FROM public.users WHERE email='qa-owner@learnersarea.test' AND role='owner' AND account_status='active') THEN
    RAISE EXCEPTION 'Expected isolated QA account baseline';
  END IF;
  IF to_regclass('riwi_qa_recovery_20261102.manifest') IS NULL OR
     EXISTS(SELECT 1 FROM riwi_qa_recovery_20261102.manifest WHERE NOT restored_verified) THEN
    RAISE EXCEPTION 'Verified recovery snapshot required';
  END IF;
  IF (SELECT count(*) FROM drizzle.__drizzle_migrations)<>66 OR EXISTS
    ((SELECT hash,created_at FROM drizzle.__drizzle_migrations EXCEPT
      SELECT hash,created_at FROM riwi_qa_recovery_20261102.drizzle_journal)
     UNION ALL
     (SELECT hash,created_at FROM riwi_qa_recovery_20261102.drizzle_journal EXCEPT
      SELECT hash,created_at FROM drizzle.__drizzle_migrations)) THEN
    RAISE EXCEPTION 'QA migration journal changed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.writing_language_patterns) OR
     EXISTS(SELECT 1 FROM public.live_classes) OR
     EXISTS(SELECT 1 FROM public.live_class_attendance) THEN
    RAISE EXCEPTION 'Data-changing targets must remain empty';
  END IF;
  FOR item IN SELECT * FROM riwi_qa_recovery_20261102.manifest
      WHERE source_schema='public' AND source_table<>'api_rate_buckets' ORDER BY source_table LOOP
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE NOWAIT',item.source_schema,item.source_table);
    SELECT coalesce(array_agg(a.attname::text),'{}'::text[]) INTO omitted
      FROM pg_attribute a WHERE a.attrelid=format('%I.%I',item.source_schema,item.source_table)::regclass
      AND a.attnum>0 AND NOT a.attisdropped AND NOT EXISTS
        (SELECT 1 FROM jsonb_array_elements(item.schema_definition->'columns') old_col
         WHERE old_col->>'name'=a.attname);
    EXECUTE format('SELECT count(*),md5(coalesce(string_agg(md5((to_jsonb(t)-$1)::text),%L ORDER BY md5((to_jsonb(t)-$1)::text)),%L)) FROM %I.%I t',
      '','',item.source_schema,item.source_table) INTO row_count_now,digest_now USING omitted;
    IF row_count_now<>item.row_count OR digest_now<>item.row_digest THEN
      RAISE EXCEPTION 'Historical data preservation check failed for %.%',item.source_schema,item.source_table;
    END IF;
  END LOOP;
  -- drizzle/0066_notification_event_idempotency.sql SHA256 b3900206718fdd3bae5867bde61221578a7e0e7b43eefd1f58202b7598aa1984
  EXECUTE $riwi_source_0_0$-- Reuse the existing in-app notification table while making event delivery
-- safe to retry. Legacy notifications without eventId are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_event_id_unique_idx
  ON notifications (user_id, ((payload ->> 'eventId')))
  WHERE payload ? 'eventId';$riwi_source_0_0$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('b3900206718fdd3bae5867bde61221578a7e0e7b43eefd1f58202b7598aa1984',1793164198221);
  -- drizzle/0067_assignment_deadline_indexes.sql SHA256 4cb10a096e82e04a91a16259febad43074236df05cd7e1651a1a71eb7813a94a
  EXECUTE $riwi_source_1_0$-- Keep lazy deadline notification reconciliation bounded for each learner.
CREATE INDEX IF NOT EXISTS assignments_target_due_idx
  ON assignments (target_user_id, due_at)
  WHERE target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS assignment_targets_student_due_idx
  ON assignment_targets (student_user_id, due_at)
  WHERE status <> 'completed';$riwi_source_1_0$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('4cb10a096e82e04a91a16259febad43074236df05cd7e1651a1a71eb7813a94a',1793164199221);
  -- drizzle/0068_writing_model_pattern_capacity.sql SHA256 1dcfc4af7b7021ac2eaf1f51bb3dd28e23713f2577ccaef059af746de75d8f31
  EXECUTE $riwi_source_2_0$-- source_ref links many chunks to one model essay. Slots provide a hard,
-- concurrent-writer-safe maximum of 70 without changing learner ownership.
ALTER TABLE public.writing_language_patterns
  ADD COLUMN IF NOT EXISTS model_slot smallint;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.writing_language_patterns
    WHERE source_ref IS NOT NULL GROUP BY lower(source_ref) HAVING count(*)>70)
  THEN RAISE EXCEPTION 'An existing model exceeds 70 chunks; no content was removed'; END IF;
END $$;

-- Existing installations can have the incorrect one-chunk-per-model index.
DROP INDEX IF EXISTS public.writing_language_patterns_source_ref_idx;

UPDATE public.writing_language_patterns SET source_ref=lower(source_ref)
WHERE source_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND source_ref<>lower(source_ref);

WITH numbered AS (
  SELECT id,row_number() OVER (PARTITION BY source_ref ORDER BY created_at,id)::smallint AS slot
  FROM public.writing_language_patterns WHERE source_ref IS NOT NULL
)
UPDATE public.writing_language_patterns p SET model_slot=n.slot
FROM numbered n WHERE p.id=n.id AND p.model_slot IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.writing_language_patterns'::regclass
    AND conname='writing_language_patterns_model_slot_check')
  THEN ALTER TABLE public.writing_language_patterns ADD CONSTRAINT writing_language_patterns_model_slot_check
    CHECK ((source_ref IS NULL AND model_slot IS NULL) OR
      (source_ref IS NOT NULL AND model_slot IS NOT NULL AND model_slot BETWEEN 1 AND 70));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS writing_language_patterns_model_slot_idx
  ON public.writing_language_patterns(source_ref,model_slot);

CREATE OR REPLACE FUNCTION public.assign_writing_pattern_model_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE chosen smallint; prior_ref text;
BEGIN
  IF NEW.source_ref IS NULL THEN NEW.model_slot=NULL; RETURN NEW; END IF;
  IF NEW.source_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    NEW.source_ref=lower(NEW.source_ref);
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.source_ref IS NOT DISTINCT FROM OLD.source_ref AND OLD.model_slot IS NOT NULL THEN
      NEW.model_slot=OLD.model_slot; RETURN NEW;
    END IF;
  ELSE
    -- Preserve idempotent INSERT ... ON CONFLICT(id) DO NOTHING at capacity.
    SELECT model_slot,source_ref INTO chosen,prior_ref FROM public.writing_language_patterns WHERE id=NEW.id;
    IF FOUND AND prior_ref IS NOT DISTINCT FROM NEW.source_ref THEN NEW.model_slot=chosen; RETURN NEW; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('writing-pattern-model:'||NEW.source_ref,0));
  SELECT s::smallint INTO chosen FROM generate_series(1,70) s
    WHERE NOT EXISTS (SELECT 1 FROM public.writing_language_patterns p
      WHERE p.source_ref=NEW.source_ref AND p.model_slot=s AND p.id<>NEW.id)
    ORDER BY s LIMIT 1;
  IF chosen IS NULL THEN
    RAISE EXCEPTION 'One essay can contain at most 70 chunks'
      USING ERRCODE='23514',CONSTRAINT='writing_language_patterns_model_capacity';
  END IF;
  NEW.model_slot=chosen; RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS writing_language_patterns_assign_model_slot ON public.writing_language_patterns;
CREATE TRIGGER writing_language_patterns_assign_model_slot
BEFORE INSERT OR UPDATE OF source_ref,model_slot ON public.writing_language_patterns
FOR EACH ROW EXECUTE FUNCTION public.assign_writing_pattern_model_slot();$riwi_source_2_0$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('1dcfc4af7b7021ac2eaf1f51bb3dd28e23713f2577ccaef059af746de75d8f31',1793164200221);
  -- drizzle/0069_video_progress_playback_duration.sql SHA256 7ae9c08a9ffc07662ac81589f2c1f24800f60d81894ff878cf08dd786a5c7ea5
  EXECUTE $riwi_source_3_0$-- Per-learner provider telemetry. Authored video content and completion rules stay authoritative.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.video_lesson_progress
  ADD COLUMN IF NOT EXISTS playback_duration_seconds integer
  CHECK (playback_duration_seconds BETWEEN 1 AND 43200);
COMMENT ON COLUMN public.video_lesson_progress.playback_duration_seconds IS
  'Learner-scoped provider duration for display when the authored video has no duration. Does not decide completion.';$riwi_source_3_0$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('7ae9c08a9ffc07662ac81589f2c1f24800f60d81894ff878cf08dd786a5c7ea5',1793164201221);
  -- drizzle/0071_shared_abuse_limits.sql SHA256 4a4d15599cfad8569c7798ec6a7b2ab5a41c99913cea70b4775fa6c51bf4e5e3
  EXECUTE $riwi_source_4_0$-- 0070 is reserved for the preserved student-learning feature branch.
-- Operational counters only: no learner content, raw IPs, emails or tokens.
CREATE TABLE IF NOT EXISTS public.api_rate_buckets (
 bucket_key varchar(64) PRIMARY KEY CHECK(bucket_key ~ '^[a-f0-9]{64}$'),
 used integer NOT NULL CHECK(used>=0), reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS api_rate_buckets_expiry_idx ON public.api_rate_buckets(reset_at);
ALTER TABLE public.api_rate_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_rate_buckets FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON public.api_rate_buckets FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON public.api_rate_buckets FROM authenticated; END IF;
END $$;$riwi_source_4_0$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('4a4d15599cfad8569c7798ec6a7b2ab5a41c99913cea70b4775fa6c51bf4e5e3',1793241854800);
  -- drizzle/0072_ai_provider_admission.sql SHA256 69115873db05746128e5885fc3101d916d3307e9d9b0b2aa6f35706c72525e8e
  EXECUTE $riwi_source_5_0$-- Operational function only; uses 0071 counters and stores no learner content.
-- One SQL call atomically claims all budgets, or raises and rolls everything back.
CREATE OR REPLACE FUNCTION public.la_claim_ai_provider_v1(keys text[], capacities integer[], windows integer[])
RETURNS TABLE(bucket_key varchar, reset_at timestamptz, "position" integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE
 n integer; chosen boolean := false; claimed_key varchar; claimed_until timestamptz;
BEGIN
 IF cardinality(keys)<>8 OR cardinality(capacities)<>8 OR cardinality(windows)<>8
    OR (SELECT count(DISTINCT k) FROM unnest(keys) k)<>8 THEN
   RAISE EXCEPTION 'invalid_ai_provider_budget' USING ERRCODE='22023';
 END IF;
 FOR n IN 1..8 LOOP
   IF keys[n] IS NULL OR keys[n] !~ '^[a-f0-9]{64}$' OR capacities[n] IS NULL
      OR capacities[n]<1 OR capacities[n]>(CASE WHEN n=2 THEN 2000 WHEN n=3 THEN 120 ELSE 1 END)
      OR windows[n] IS DISTINCT FROM (CASE WHEN n IN (2,3) THEN 3600 ELSE 180 END) THEN
     RAISE EXCEPTION 'invalid_ai_provider_budget' USING ERRCODE='22023';
   END IF;
 END LOOP;
 FOR n IN 1..8 LOOP
   INSERT INTO public.api_rate_buckets AS b(bucket_key,used,reset_at)
   VALUES(keys[n],1,statement_timestamp()+windows[n]*interval '1 second')
   ON CONFLICT ON CONSTRAINT api_rate_buckets_pkey DO UPDATE SET
     used=CASE WHEN b.reset_at<=statement_timestamp() THEN 1 ELSE b.used+1 END,
     reset_at=CASE WHEN b.reset_at<=statement_timestamp() THEN EXCLUDED.reset_at ELSE b.reset_at END
   WHERE b.reset_at<=statement_timestamp() OR b.used<capacities[n]
   RETURNING b.bucket_key,b.reset_at INTO claimed_key,claimed_until;
   IF FOUND THEN
     RETURN QUERY SELECT claimed_key,claimed_until,n-1;
     IF n>=5 THEN chosen:=true;EXIT;END IF;
   ELSIF n<=4 THEN
     RAISE EXCEPTION 'ai_provider_budget_full' USING ERRCODE='P0001';
   END IF;
 END LOOP;
 IF NOT chosen THEN RAISE EXCEPTION 'ai_provider_budget_full' USING ERRCODE='P0001';END IF;
 DELETE FROM public.api_rate_buckets b WHERE b.bucket_key IN (
   SELECT expired.bucket_key FROM public.api_rate_buckets expired
   WHERE expired.reset_at<statement_timestamp()-interval '1 hour' AND NOT expired.bucket_key=ANY(keys)
   ORDER BY expired.reset_at LIMIT 8 FOR UPDATE SKIP LOCKED
 );
END;
$$;
REVOKE ALL ON FUNCTION public.la_claim_ai_provider_v1(text[],integer[],integer[]) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   REVOKE ALL ON FUNCTION public.la_claim_ai_provider_v1(text[],integer[],integer[]) FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
   REVOKE ALL ON FUNCTION public.la_claim_ai_provider_v1(text[],integer[],integer[]) FROM authenticated;
 END IF;
END $$;$riwi_source_5_0$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('69115873db05746128e5885fc3101d916d3307e9d9b0b2aa6f35706c72525e8e',1793370499000);
  -- drizzle/0073_live_classes_youtube_chat_attendance.sql SHA256 70726841b2dc2d52bb8fbf13be3d3ad7e6d61ab8d0fb2dae918846342b96b47b
  EXECUTE $riwi_source_6_0$-- Phase 2: Additive schema for YouTube Live Classes, class enrollments, native live chat,
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
END $$;$riwi_source_6_0$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('70726841b2dc2d52bb8fbf13be3d3ad7e6d61ab8d0fb2dae918846342b96b47b',1793370500000);
  -- drizzle/0074_mock_hybrid_grading_system.sql SHA256 16338cf06c2d025b2294c662775d302e209600151a2f2e312731e550163ef635
  EXECUTE $riwi_source_7_0$-- 0074 Mock Hybrid Grading System (P1): weekly schedules, extended mock_attempts,
-- section submissions, writing answers, speaking audio, grading batches,
-- append-only grading revisions, import issues, and mock audit events.
--
-- Additive, idempotent, forward-safe migration. Does not alter or drop existing
-- learner history or content tables.

CREATE TABLE IF NOT EXISTS "mock_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mock_test_id" uuid NOT NULL REFERENCES "public"."mock_tests"("id") ON DELETE cascade ON UPDATE no action,
	"weekly_slot" varchar(32) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" varchar(40) DEFAULT 'Asia/Tashkent' NOT NULL,
	"policy_version" varchar(24) DEFAULT 'v1' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_schedules_window_chk" CHECK ("ends_at" > "starts_at")
);$riwi_source_7_0$;
  EXECUTE $riwi_source_7_1$CREATE UNIQUE INDEX IF NOT EXISTS "mock_schedules_test_slot_uq" ON "mock_schedules" USING btree ("mock_test_id","weekly_slot");$riwi_source_7_1$;
  EXECUTE $riwi_source_7_2$CREATE INDEX IF NOT EXISTS "mock_schedules_slot_window_idx" ON "mock_schedules" USING btree ("weekly_slot","starts_at","ends_at");$riwi_source_7_2$;
  EXECUTE $riwi_source_7_3$ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "schedule_id" uuid REFERENCES "public"."mock_schedules"("id") ON DELETE set null ON UPDATE no action;$riwi_source_7_3$;
  EXECUTE $riwi_source_7_4$ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "weekly_slot" varchar(32);$riwi_source_7_4$;
  EXECUTE $riwi_source_7_5$ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone;$riwi_source_7_5$;
  EXECUTE $riwi_source_7_6$ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "finalized_at" timestamp with time zone;$riwi_source_7_6$;
  EXECUTE $riwi_source_7_7$ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "deadline_at" timestamp with time zone;$riwi_source_7_7$;
  EXECUTE $riwi_source_7_8$ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "content_snapshot_hash" varchar(64);$riwi_source_7_8$;
  EXECUTE $riwi_source_7_9$ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "active_section_position" integer DEFAULT 1 NOT NULL;$riwi_source_7_9$;
  EXECUTE $riwi_source_7_10$ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "section_deadlines" jsonb;$riwi_source_7_10$;
  EXECUTE $riwi_source_7_11$CREATE UNIQUE INDEX IF NOT EXISTS "mock_attempts_user_weekly_slot_uq" ON "mock_attempts" USING btree ("user_id","weekly_slot") WHERE "weekly_slot" IS NOT NULL AND "status" <> 'abandoned';$riwi_source_7_11$;
  EXECUTE $riwi_source_7_12$CREATE INDEX IF NOT EXISTS "mock_attempts_user_status_idx" ON "mock_attempts" USING btree ("user_id","status","started_at" DESC);$riwi_source_7_12$;
  EXECUTE $riwi_source_7_13$CREATE TABLE IF NOT EXISTS "mock_section_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL REFERENCES "public"."mock_attempts"("id") ON DELETE cascade ON UPDATE no action,
	"skill" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'in_progress' NOT NULL,
	"raw_score" integer,
	"score_max" integer,
	"band" real,
	"answers_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_details" jsonb,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"answer_hash" varchar(64),
	"content_version_id" uuid REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_section_submissions_skill_chk" CHECK ("skill" IN ('listening','reading','writing','speaking')),
	CONSTRAINT "mock_section_submissions_band_chk" CHECK ("band" IS NULL OR ("band" >= 0 AND "band" <= 9))
);$riwi_source_7_13$;
  EXECUTE $riwi_source_7_14$CREATE UNIQUE INDEX IF NOT EXISTS "mock_section_submissions_attempt_skill_uq" ON "mock_section_submissions" USING btree ("attempt_id","skill");$riwi_source_7_14$;
  EXECUTE $riwi_source_7_15$CREATE INDEX IF NOT EXISTS "mock_section_submissions_skill_status_idx" ON "mock_section_submissions" USING btree ("skill","status","submitted_at" DESC);$riwi_source_7_15$;
  EXECUTE $riwi_source_7_16$CREATE TABLE IF NOT EXISTS "mock_writing_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL REFERENCES "public"."mock_attempts"("id") ON DELETE cascade ON UPDATE no action,
	"task_type" varchar(16) NOT NULL,
	"prompt_snapshot_id" uuid REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action,
	"prompt_text" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"media_ref" text,
	"media_sha256" varchar(64),
	"word_count" integer DEFAULT 0 NOT NULL,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"finalized_at" timestamp with time zone,
	"sha256" varchar(64),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_writing_answers_task_type_chk" CHECK ("task_type" IN ('task1','task2')),
	CONSTRAINT "mock_writing_answers_word_count_chk" CHECK ("word_count" >= 0)
);$riwi_source_7_16$;
  EXECUTE $riwi_source_7_17$CREATE UNIQUE INDEX IF NOT EXISTS "mock_writing_answers_attempt_task_uq" ON "mock_writing_answers" USING btree ("attempt_id","task_type");$riwi_source_7_17$;
  EXECUTE $riwi_source_7_18$CREATE TABLE IF NOT EXISTS "mock_speaking_audio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL REFERENCES "public"."mock_attempts"("id") ON DELETE cascade ON UPDATE no action,
	"part" varchar(8) NOT NULL,
	"question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"object_key" text NOT NULL,
	"upload_intent_id" uuid REFERENCES "public"."upload_intents"("id") ON DELETE set null ON UPDATE no action,
	"codec" varchar(64) NOT NULL,
	"mime_type" varchar(120) DEFAULT 'audio/webm' NOT NULL,
	"bytes" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"capture_status" varchar(32) DEFAULT 'finalized' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"finalized_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_speaking_audio_part_chk" CHECK ("part" IN ('P1','P2','P3')),
	CONSTRAINT "mock_speaking_audio_bytes_chk" CHECK ("bytes" > 0),
	CONSTRAINT "mock_speaking_audio_duration_chk" CHECK ("duration_ms" >= 0),
	CONSTRAINT "mock_speaking_audio_status_chk" CHECK ("capture_status" IN ('recording','finalized','incomplete','needs_review'))
);$riwi_source_7_18$;
  EXECUTE $riwi_source_7_19$CREATE UNIQUE INDEX IF NOT EXISTS "mock_speaking_audio_attempt_part_uq" ON "mock_speaking_audio" USING btree ("attempt_id","part");$riwi_source_7_19$;
  EXECUTE $riwi_source_7_20$CREATE TABLE IF NOT EXISTS "mock_grading_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_code" varchar(64) NOT NULL,
	"scope" varchar(32) NOT NULL,
	"section" varchar(16) NOT NULL,
	"filter_mode" varchar(24) DEFAULT 'ungraded' NOT NULL,
	"date_from" date,
	"date_to" date,
	"created_by" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"export_manifest_hash" varchar(64) NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"student_alias_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'exported' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "mock_grading_batches_scope_chk" CHECK ("scope" IN ('assigned','owner')),
	CONSTRAINT "mock_grading_batches_section_chk" CHECK ("section" IN ('writing','speaking')),
	CONSTRAINT "mock_grading_batches_filter_chk" CHECK ("filter_mode" IN ('ungraded','all')),
	CONSTRAINT "mock_grading_batches_status_chk" CHECK ("status" IN ('awaiting_export','exported','imported_draft','needs_review','approved','published','retryable_failure'))
);$riwi_source_7_20$;
  EXECUTE $riwi_source_7_21$CREATE UNIQUE INDEX IF NOT EXISTS "mock_grading_batches_code_uq" ON "mock_grading_batches" USING btree ("batch_code");$riwi_source_7_21$;
  EXECUTE $riwi_source_7_22$CREATE INDEX IF NOT EXISTS "mock_grading_batches_creator_idx" ON "mock_grading_batches" USING btree ("created_by","created_at" DESC);$riwi_source_7_22$;
  EXECUTE $riwi_source_7_23$CREATE TABLE IF NOT EXISTS "mock_grading_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL REFERENCES "public"."mock_attempts"("id") ON DELETE cascade ON UPDATE no action,
	"section" varchar(16) NOT NULL,
	"batch_id" uuid NOT NULL REFERENCES "public"."mock_grading_batches"("id") ON DELETE cascade ON UPDATE no action,
	"rubric_version" varchar(32) NOT NULL,
	"source" varchar(32) DEFAULT 'gemini_manual' NOT NULL,
	"status" varchar(32) DEFAULT 'imported_draft' NOT NULL,
	"payload_json" jsonb NOT NULL,
	"raw_gemini_json" jsonb,
	"payload_sha256" varchar(64) NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"calculated_band" real,
	"task1_band" real,
	"task2_band" real,
	"author_user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action,
	"approved_by" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"approved_at" timestamp with time zone,
	"published_by" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"published_at" timestamp with time zone,
	"supersedes_id" uuid REFERENCES "public"."mock_grading_revisions"("id") ON DELETE set null ON UPDATE no action,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_grading_revisions_section_chk" CHECK ("section" IN ('writing','speaking')),
	CONSTRAINT "mock_grading_revisions_source_chk" CHECK ("source" IN ('gemini_manual','teacher_revision','owner_revision')),
	CONSTRAINT "mock_grading_revisions_status_chk" CHECK ("status" IN ('imported_draft','needs_review','approved','published','superseded')),
	CONSTRAINT "mock_grading_revisions_band_chk" CHECK ("calculated_band" IS NULL OR ("calculated_band" >= 0 AND "calculated_band" <= 9))
);$riwi_source_7_23$;
  EXECUTE $riwi_source_7_24$CREATE UNIQUE INDEX IF NOT EXISTS "mock_grading_revisions_idempotent_import_uq" ON "mock_grading_revisions" USING btree ("batch_id","attempt_id","section","payload_sha256") WHERE "source" = 'gemini_manual';$riwi_source_7_24$;
  EXECUTE $riwi_source_7_25$CREATE INDEX IF NOT EXISTS "mock_grading_revisions_attempt_section_idx" ON "mock_grading_revisions" USING btree ("attempt_id","section","created_at" DESC);$riwi_source_7_25$;
  EXECUTE $riwi_source_7_26$CREATE INDEX IF NOT EXISTS "mock_grading_revisions_batch_status_idx" ON "mock_grading_revisions" USING btree ("batch_id","status");$riwi_source_7_26$;
  EXECUTE $riwi_source_7_27$CREATE TABLE IF NOT EXISTS "mock_grading_import_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL REFERENCES "public"."mock_grading_batches"("id") ON DELETE cascade ON UPDATE no action,
	"row_number" integer,
	"attempt_id" uuid REFERENCES "public"."mock_attempts"("id") ON DELETE set null ON UPDATE no action,
	"student_alias" varchar(32),
	"error_code" varchar(64) NOT NULL,
	"details" text NOT NULL,
	"created_by" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);$riwi_source_7_27$;
  EXECUTE $riwi_source_7_28$CREATE INDEX IF NOT EXISTS "mock_grading_import_issues_batch_idx" ON "mock_grading_import_issues" USING btree ("batch_id","created_at" DESC);$riwi_source_7_28$;
  EXECUTE $riwi_source_7_29$CREATE TABLE IF NOT EXISTS "mock_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"attempt_id" uuid REFERENCES "public"."mock_attempts"("id") ON DELETE set null ON UPDATE no action,
	"batch_id" uuid REFERENCES "public"."mock_grading_batches"("id") ON DELETE set null ON UPDATE no action,
	"action" varchar(80) NOT NULL,
	"source_hash" varchar(64),
	"old_revision_id" uuid REFERENCES "public"."mock_grading_revisions"("id") ON DELETE set null ON UPDATE no action,
	"new_revision_id" uuid REFERENCES "public"."mock_grading_revisions"("id") ON DELETE set null ON UPDATE no action,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);$riwi_source_7_29$;
  EXECUTE $riwi_source_7_30$CREATE INDEX IF NOT EXISTS "mock_audit_events_attempt_idx" ON "mock_audit_events" USING btree ("attempt_id","at" DESC);$riwi_source_7_30$;
  EXECUTE $riwi_source_7_31$CREATE INDEX IF NOT EXISTS "mock_audit_events_batch_idx" ON "mock_audit_events" USING btree ("batch_id","at" DESC);$riwi_source_7_31$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('16338cf06c2d025b2294c662775d302e209600151a2f2e312731e550163ef635',1793370501000);
  -- drizzle/0075_riwi_core_and_governance.sql SHA256 0007b0f95a2142bcc0d6df9bc2fb812cee2a6ac02d00f6ef5e71fb40dbf03076
  EXECUTE $riwi_source_8_0$-- Forward-only RIWI Core & Governance Migration (ported from LEGACY_RIWI 0036..0044)$riwi_source_8_0$;
  EXECUTE $riwi_source_8_1$CREATE TYPE "public"."riwi_conflict_state" AS ENUM('open', 'resolved', 'accepted', 'rejected');$riwi_source_8_1$;
  EXECUTE $riwi_source_8_2$CREATE TYPE "public"."riwi_conversation_message_role" AS ENUM('user', 'assistant');$riwi_source_8_2$;
  EXECUTE $riwi_source_8_3$CREATE TYPE "public"."riwi_experiment_state" AS ENUM('pending', 'running', 'completed', 'partial', 'failed');$riwi_source_8_3$;
  EXECUTE $riwi_source_8_4$CREATE TYPE "public"."riwi_knowledge_scope" AS ENUM('global', 'role', 'user');$riwi_source_8_4$;
  EXECUTE $riwi_source_8_5$CREATE TYPE "public"."riwi_knowledge_source_type" AS ENUM('owner_instruction', 'ielts_rubric', 'grammar_material', 'vocabulary_material', 'speaking_material', 'writing_material', 'dictionary_material', 'learning_methodology', 'course_document', 'policy', 'verified_example', 'provider_evaluation', 'teacher_correction', 'owner_correction', 'regression_fixture');$riwi_source_8_5$;
  EXECUTE $riwi_source_8_6$CREATE TYPE "public"."riwi_knowledge_state" AS ENUM('draft', 'parsed', 'analyzed', 'candidate', 'approved', 'active', 'superseded', 'rejected', 'quarantined');$riwi_source_8_6$;
  EXECUTE $riwi_source_8_7$CREATE TYPE "public"."riwi_learning_signal_state" AS ENUM('candidate', 'in_review', 'accepted', 'rejected', 'promoted');$riwi_source_8_7$;
  EXECUTE $riwi_source_8_8$CREATE TYPE "public"."riwi_learning_signal_type" AS ENUM('owner_correction', 'teacher_correction', 'provider_disagreement', 'provider_agreement', 'student_outcome', 'rubric_reference', 'known_good_example', 'known_bad_example', 'retrieval_failure', 'hallucination_report', 'tool_failure', 'user_feedback', 'manual_qa_finding');$riwi_source_8_8$;
  EXECUTE $riwi_source_8_9$CREATE TYPE "public"."riwi_review_decision" AS ENUM('approve', 'reject', 'request_changes');$riwi_source_8_9$;
  EXECUTE $riwi_source_8_10$CREATE TABLE "riwi_action_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"tool_name" varchar(80) NOT NULL,
	"target_id" varchar(80),
	"input_hash" varchar(64) NOT NULL,
	"idempotency_key" varchar(80) NOT NULL,
	"preview" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);$riwi_source_8_10$;
  EXECUTE $riwi_source_8_11$CREATE TABLE "riwi_conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "riwi_conversation_message_role" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_conversation_messages_content_check" CHECK (length("riwi_conversation_messages"."content") between 1 and 6000)
);$riwi_source_8_11$;
  EXECUTE $riwi_source_8_12$CREATE TABLE "riwi_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_at_creation" "role" NOT NULL,
	"locale" varchar(5) DEFAULT 'uz' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);$riwi_source_8_12$;
  EXECUTE $riwi_source_8_13$CREATE TABLE "riwi_knowledge_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_source_id" uuid NOT NULL,
	"candidate_unit_id" uuid NOT NULL,
	"active_source_id" uuid NOT NULL,
	"active_unit_id" uuid NOT NULL,
	"conflict_key" varchar(64) NOT NULL,
	"reason" varchar(60) NOT NULL,
	"state" "riwi_conflict_state" DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolution_note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);$riwi_source_8_13$;
  EXECUTE $riwi_source_8_14$CREATE TABLE "riwi_knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "riwi_knowledge_source_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"provenance" varchar(500) NOT NULL,
	"rights_class" varchar(40) NOT NULL,
	"authority" smallint DEFAULT 30 NOT NULL,
	"scope" "riwi_knowledge_scope" DEFAULT 'global' NOT NULL,
	"scope_role" "role",
	"scope_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"state" "riwi_knowledge_state" DEFAULT 'draft' NOT NULL,
	"source_object_key" text,
	"parser_version" varchar(40),
	"unit_count" integer DEFAULT 0 NOT NULL,
	"supersedes_source_id" uuid,
	"created_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_knowledge_sources_authority_check" CHECK ("riwi_knowledge_sources"."authority" between 0 and 100),
	CONSTRAINT "riwi_knowledge_sources_version_check" CHECK ("riwi_knowledge_sources"."version" > 0),
	CONSTRAINT "riwi_knowledge_sources_unit_count_check" CHECK ("riwi_knowledge_sources"."unit_count" >= 0)
);$riwi_source_8_14$;
  EXECUTE $riwi_source_8_15$CREATE TABLE "riwi_knowledge_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" varchar(240),
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"character_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_knowledge_units_ordinal_check" CHECK ("riwi_knowledge_units"."ordinal" >= 0),
	CONSTRAINT "riwi_knowledge_units_character_count_check" CHECK ("riwi_knowledge_units"."character_count" between 1 and 4000)
);$riwi_source_8_15$;
  EXECUTE $riwi_source_8_16$CREATE TABLE "riwi_learning_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"decision" "riwi_review_decision" NOT NULL,
	"reason" varchar(1000) NOT NULL,
	"regression_fixture_id" varchar(120),
	"resulting_source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_learning_reviews_approve_regression_check" CHECK ("riwi_learning_reviews"."decision" <> 'approve' or "riwi_learning_reviews"."regression_fixture_id" is not null)
);$riwi_source_8_16$;
  EXECUTE $riwi_source_8_17$CREATE TABLE "riwi_learning_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_type" "riwi_learning_signal_type" NOT NULL,
	"state" "riwi_learning_signal_state" DEFAULT 'candidate' NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "role" NOT NULL,
	"target_user_id" uuid,
	"source_id" uuid,
	"provider_id" varchar(60),
	"model" varchar(120),
	"prompt_version" varchar(60),
	"rubric_version" varchar(60),
	"candidate_claim" varchar(4000) NOT NULL,
	"evidence_summary" varchar(1200) NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"scope" "riwi_knowledge_scope" DEFAULT 'global' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);$riwi_source_8_17$;
  EXECUTE $riwi_source_8_18$CREATE TABLE "riwi_provider_experiment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"provider_id" varchar(60) NOT NULL,
	"model" varchar(120),
	"state" varchar(24) NOT NULL,
	"normalized_result" jsonb,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_micros" integer,
	"safe_error_code" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_provider_experiment_results_duration_check" CHECK ("riwi_provider_experiment_results"."duration_ms" >= 0)
);$riwi_source_8_18$;
  EXECUTE $riwi_source_8_19$CREATE TABLE "riwi_provider_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"task_profile" varchar(60) NOT NULL,
	"fixture_id" varchar(120) NOT NULL,
	"providers" jsonb NOT NULL,
	"state" "riwi_experiment_state" DEFAULT 'pending' NOT NULL,
	"budget_micros" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "riwi_provider_experiments_budget_check" CHECK ("riwi_provider_experiments"."budget_micros" >= 0)
);$riwi_source_8_19$;
  EXECUTE $riwi_source_8_20$CREATE TABLE "riwi_usage_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "role" NOT NULL,
	"task_profile" varchar(60) NOT NULL,
	"provider_id" varchar(60),
	"model" varchar(120),
	"state" varchar(24) NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_micros" integer,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_usage_metrics_duration_check" CHECK ("riwi_usage_metrics"."duration_ms" >= 0),
	CONSTRAINT "riwi_usage_metrics_tokens_check" CHECK (("riwi_usage_metrics"."input_tokens" is null or "riwi_usage_metrics"."input_tokens" >= 0) and ("riwi_usage_metrics"."output_tokens" is null or "riwi_usage_metrics"."output_tokens" >= 0))
);$riwi_source_8_20$;
  EXECUTE $riwi_source_8_21$ALTER TABLE "riwi_action_confirmations" ADD CONSTRAINT "riwi_action_confirmations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_21$;
  EXECUTE $riwi_source_8_22$ALTER TABLE "riwi_conversation_messages" ADD CONSTRAINT "riwi_conversation_messages_conversation_id_riwi_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."riwi_conversations"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_22$;
  EXECUTE $riwi_source_8_23$ALTER TABLE "riwi_conversations" ADD CONSTRAINT "riwi_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_23$;
  EXECUTE $riwi_source_8_24$ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_candidate_source_id_riwi_knowledge_sources_id_fk" FOREIGN KEY ("candidate_source_id") REFERENCES "public"."riwi_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_24$;
  EXECUTE $riwi_source_8_25$ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_candidate_unit_id_riwi_knowledge_units_id_fk" FOREIGN KEY ("candidate_unit_id") REFERENCES "public"."riwi_knowledge_units"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_25$;
  EXECUTE $riwi_source_8_26$ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_active_source_id_riwi_knowledge_sources_id_fk" FOREIGN KEY ("active_source_id") REFERENCES "public"."riwi_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_26$;
  EXECUTE $riwi_source_8_27$ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_active_unit_id_riwi_knowledge_units_id_fk" FOREIGN KEY ("active_unit_id") REFERENCES "public"."riwi_knowledge_units"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_27$;
  EXECUTE $riwi_source_8_28$ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;$riwi_source_8_28$;
  EXECUTE $riwi_source_8_29$ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_scope_user_id_users_id_fk" FOREIGN KEY ("scope_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_29$;
  EXECUTE $riwi_source_8_30$ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;$riwi_source_8_30$;
  EXECUTE $riwi_source_8_31$ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;$riwi_source_8_31$;
  EXECUTE $riwi_source_8_32$ALTER TABLE "riwi_knowledge_units" ADD CONSTRAINT "riwi_knowledge_units_source_id_riwi_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."riwi_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_32$;
  EXECUTE $riwi_source_8_33$ALTER TABLE "riwi_learning_reviews" ADD CONSTRAINT "riwi_learning_reviews_signal_id_riwi_learning_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."riwi_learning_signals"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_33$;
  EXECUTE $riwi_source_8_34$ALTER TABLE "riwi_learning_reviews" ADD CONSTRAINT "riwi_learning_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;$riwi_source_8_34$;
  EXECUTE $riwi_source_8_35$ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;$riwi_source_8_35$;
  EXECUTE $riwi_source_8_36$ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;$riwi_source_8_36$;
  EXECUTE $riwi_source_8_37$ALTER TABLE "riwi_provider_experiment_results" ADD CONSTRAINT "riwi_provider_experiment_results_experiment_id_riwi_provider_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."riwi_provider_experiments"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_8_37$;
  EXECUTE $riwi_source_8_38$ALTER TABLE "riwi_provider_experiments" ADD CONSTRAINT "riwi_provider_experiments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;$riwi_source_8_38$;
  EXECUTE $riwi_source_8_39$ALTER TABLE "riwi_usage_metrics" ADD CONSTRAINT "riwi_usage_metrics_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;$riwi_source_8_39$;
  EXECUTE $riwi_source_8_40$CREATE UNIQUE INDEX "riwi_action_confirmations_idempotency_uidx" ON "riwi_action_confirmations" USING btree ("actor_user_id","idempotency_key");$riwi_source_8_40$;
  EXECUTE $riwi_source_8_41$CREATE INDEX "riwi_action_confirmations_expiry_idx" ON "riwi_action_confirmations" USING btree ("expires_at");$riwi_source_8_41$;
  EXECUTE $riwi_source_8_42$CREATE INDEX "riwi_conversation_messages_order_idx" ON "riwi_conversation_messages" USING btree ("conversation_id","created_at","id");$riwi_source_8_42$;
  EXECUTE $riwi_source_8_43$CREATE INDEX "riwi_conversations_owner_updated_idx" ON "riwi_conversations" USING btree ("user_id","updated_at");$riwi_source_8_43$;
  EXECUTE $riwi_source_8_44$CREATE INDEX "riwi_conversations_expiry_idx" ON "riwi_conversations" USING btree ("expires_at");$riwi_source_8_44$;
  EXECUTE $riwi_source_8_45$CREATE INDEX "riwi_knowledge_conflicts_candidate_state_idx" ON "riwi_knowledge_conflicts" USING btree ("candidate_source_id","state");$riwi_source_8_45$;
  EXECUTE $riwi_source_8_46$CREATE UNIQUE INDEX "riwi_knowledge_conflicts_pair_uidx" ON "riwi_knowledge_conflicts" USING btree ("candidate_unit_id","active_unit_id");$riwi_source_8_46$;
  EXECUTE $riwi_source_8_47$CREATE INDEX "riwi_knowledge_sources_state_idx" ON "riwi_knowledge_sources" USING btree ("state","authority","updated_at");$riwi_source_8_47$;
  EXECUTE $riwi_source_8_48$CREATE INDEX "riwi_knowledge_sources_scope_idx" ON "riwi_knowledge_sources" USING btree ("scope","scope_role","scope_user_id","state");$riwi_source_8_48$;
  EXECUTE $riwi_source_8_49$CREATE INDEX "riwi_knowledge_sources_checksum_idx" ON "riwi_knowledge_sources" USING btree ("checksum");$riwi_source_8_49$;
  EXECUTE $riwi_source_8_50$CREATE UNIQUE INDEX "riwi_knowledge_units_source_ordinal_uidx" ON "riwi_knowledge_units" USING btree ("source_id","ordinal");$riwi_source_8_50$;
  EXECUTE $riwi_source_8_51$CREATE INDEX "riwi_knowledge_units_content_hash_idx" ON "riwi_knowledge_units" USING btree ("content_hash");$riwi_source_8_51$;
  EXECUTE $riwi_source_8_52$CREATE INDEX "riwi_knowledge_units_content_fts_idx" ON "riwi_knowledge_units" USING gin (to_tsvector('simple', "content"));$riwi_source_8_52$;
  EXECUTE $riwi_source_8_53$CREATE INDEX "riwi_learning_reviews_signal_idx" ON "riwi_learning_reviews" USING btree ("signal_id","created_at");$riwi_source_8_53$;
  EXECUTE $riwi_source_8_54$CREATE INDEX "riwi_learning_signals_state_created_idx" ON "riwi_learning_signals" USING btree ("state","created_at");$riwi_source_8_54$;
  EXECUTE $riwi_source_8_55$CREATE INDEX "riwi_learning_signals_actor_idx" ON "riwi_learning_signals" USING btree ("actor_user_id","created_at");$riwi_source_8_55$;
  EXECUTE $riwi_source_8_56$CREATE INDEX "riwi_learning_signals_target_idx" ON "riwi_learning_signals" USING btree ("target_user_id","created_at");$riwi_source_8_56$;
  EXECUTE $riwi_source_8_57$CREATE UNIQUE INDEX "riwi_provider_experiment_results_pair_uidx" ON "riwi_provider_experiment_results" USING btree ("experiment_id","provider_id");$riwi_source_8_57$;
  EXECUTE $riwi_source_8_58$CREATE INDEX "riwi_provider_experiments_actor_created_idx" ON "riwi_provider_experiments" USING btree ("actor_user_id","created_at");$riwi_source_8_58$;
  EXECUTE $riwi_source_8_59$CREATE INDEX "riwi_usage_metrics_role_created_idx" ON "riwi_usage_metrics" USING btree ("actor_role","created_at");$riwi_source_8_59$;
  EXECUTE $riwi_source_8_60$CREATE INDEX "riwi_usage_metrics_actor_created_idx" ON "riwi_usage_metrics" USING btree ("actor_user_id","created_at");$riwi_source_8_60$;
  EXECUTE $riwi_source_8_61$ALTER TABLE "riwi_learning_reviews" DROP CONSTRAINT "riwi_learning_reviews_approve_regression_check";$riwi_source_8_61$;
  EXECUTE $riwi_source_8_62$ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "regression_fixture_id" varchar(120);$riwi_source_8_62$;
  EXECUTE $riwi_source_8_63$ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "regression_evidence_hash" varchar(64);$riwi_source_8_63$;
  EXECUTE $riwi_source_8_64$ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "regression_passed_at" timestamp with time zone;$riwi_source_8_64$;
  EXECUTE $riwi_source_8_65$ALTER TABLE "riwi_learning_reviews" ADD COLUMN "regression_evidence_hash" varchar(64);$riwi_source_8_65$;
  EXECUTE $riwi_source_8_66$ALTER TABLE "riwi_learning_reviews" ADD COLUMN "regression_passed_at" timestamp with time zone;$riwi_source_8_66$;
  EXECUTE $riwi_source_8_67$CREATE UNIQUE INDEX "riwi_knowledge_sources_type_checksum_uidx" ON "riwi_knowledge_sources" USING btree ("source_type","checksum");$riwi_source_8_67$;
  EXECUTE $riwi_source_8_68$ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_scope_consistency_check" CHECK ((
    ("riwi_knowledge_sources"."scope" = 'global' and "riwi_knowledge_sources"."scope_role" is null and "riwi_knowledge_sources"."scope_user_id" is null) or
    ("riwi_knowledge_sources"."scope" = 'role' and "riwi_knowledge_sources"."scope_role" is not null and "riwi_knowledge_sources"."scope_user_id" is null) or
    ("riwi_knowledge_sources"."scope" = 'user' and "riwi_knowledge_sources"."scope_role" is null and "riwi_knowledge_sources"."scope_user_id" is not null)
  ));$riwi_source_8_68$;
  EXECUTE $riwi_source_8_69$ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_active_regression_check" CHECK ("riwi_knowledge_sources"."state" <> 'active' or (
    "riwi_knowledge_sources"."regression_fixture_id" is not null and "riwi_knowledge_sources"."regression_evidence_hash" is not null and "riwi_knowledge_sources"."regression_passed_at" is not null
  ));$riwi_source_8_69$;
  EXECUTE $riwi_source_8_70$ALTER TABLE "riwi_learning_reviews" ADD CONSTRAINT "riwi_learning_reviews_approve_regression_check" CHECK ("riwi_learning_reviews"."decision" <> 'approve' or (
    "riwi_learning_reviews"."regression_fixture_id" is not null and "riwi_learning_reviews"."regression_evidence_hash" is not null and "riwi_learning_reviews"."regression_passed_at" is not null
  ));$riwi_source_8_70$;
  EXECUTE $riwi_source_8_71$ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_scope_target_check" CHECK ((
    ("riwi_learning_signals"."scope" = 'global' and "riwi_learning_signals"."target_user_id" is null) or
    ("riwi_learning_signals"."scope" = 'user' and "riwi_learning_signals"."target_user_id" is not null)
  ));$riwi_source_8_71$;
  EXECUTE $riwi_source_8_72$ALTER TABLE "riwi_usage_metrics" ADD CONSTRAINT "riwi_usage_metrics_cost_check" CHECK ("riwi_usage_metrics"."estimated_cost_micros" is null or "riwi_usage_metrics"."estimated_cost_micros" >= 0);$riwi_source_8_72$;
  EXECUTE $riwi_source_8_73$ALTER TABLE "riwi_provider_experiments" ADD COLUMN "idempotency_key" varchar(80);$riwi_source_8_73$;
  EXECUTE $riwi_source_8_74$UPDATE "riwi_provider_experiments" SET "idempotency_key" = 'legacy-' || "id"::text WHERE "idempotency_key" IS NULL;$riwi_source_8_74$;
  EXECUTE $riwi_source_8_75$ALTER TABLE "riwi_provider_experiments" ALTER COLUMN "idempotency_key" SET NOT NULL;$riwi_source_8_75$;
  EXECUTE $riwi_source_8_76$CREATE UNIQUE INDEX "riwi_provider_experiments_actor_idempotency_uidx" ON "riwi_provider_experiments" USING btree ("actor_user_id","idempotency_key");$riwi_source_8_76$;
  EXECUTE $riwi_source_8_77$ALTER TYPE "public"."riwi_learning_signal_type" ADD VALUE 'provider_failure' BEFORE 'user_feedback';$riwi_source_8_77$;
  EXECUTE $riwi_source_8_78$CREATE UNIQUE INDEX "riwi_learning_signals_actor_source_uidx" ON "riwi_learning_signals" USING btree ("actor_user_id","signal_type","source_id") WHERE "riwi_learning_signals"."actor_user_id" is not null and "riwi_learning_signals"."source_id" is not null;$riwi_source_8_78$;
  EXECUTE $riwi_source_8_79$ALTER TABLE "riwi_learning_signals" DROP CONSTRAINT "riwi_learning_signals_scope_target_check";$riwi_source_8_79$;
  EXECUTE $riwi_source_8_80$ALTER TABLE "riwi_learning_signals" ALTER COLUMN "source_id" SET DEFAULT gen_random_uuid();$riwi_source_8_80$;
  EXECUTE $riwi_source_8_81$UPDATE "riwi_learning_signals" SET "source_id" = gen_random_uuid() WHERE "source_id" IS NULL;$riwi_source_8_81$;
  EXECUTE $riwi_source_8_82$ALTER TABLE "riwi_learning_signals" ALTER COLUMN "source_id" SET NOT NULL;$riwi_source_8_82$;
  EXECUTE $riwi_source_8_83$ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_scope_target_check" CHECK ((
    ("riwi_learning_signals"."scope" = 'global' and "riwi_learning_signals"."target_user_id" is null) or
    "riwi_learning_signals"."scope" = 'user'
  ));$riwi_source_8_83$;
  EXECUTE $riwi_source_8_84$ALTER TABLE "riwi_learning_reviews" ADD CONSTRAINT "riwi_learning_reviews_resulting_source_id_riwi_knowledge_sources_id_fk" FOREIGN KEY ("resulting_source_id") REFERENCES "public"."riwi_knowledge_sources"("id") ON DELETE set null ON UPDATE no action;$riwi_source_8_84$;
  EXECUTE $riwi_source_8_85$ALTER TYPE "public"."upload_purpose" ADD VALUE 'riwi_knowledge_source';$riwi_source_8_85$;
  EXECUTE $riwi_source_8_86$ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "source_checksum" varchar(64);$riwi_source_8_86$;
  EXECUTE $riwi_source_8_87$ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_source_checksum_check" CHECK ("riwi_knowledge_sources"."source_checksum" is null or "riwi_knowledge_sources"."source_checksum" ~ '^[a-f0-9]{64}$');$riwi_source_8_87$;
  EXECUTE $riwi_source_8_88$CREATE INDEX "users_riwi_active_student_target_idx" ON "users" USING btree (lower(trim("name")),"id") WHERE "users"."role" = 'student' AND "users"."account_status" = 'active';$riwi_source_8_88$;
  EXECUTE $riwi_source_8_89$DROP INDEX "riwi_provider_experiments_actor_created_idx";$riwi_source_8_89$;
  EXECUTE $riwi_source_8_90$CREATE INDEX "audit_log_created_id_idx" ON "audit_log" USING btree ("created_at","id");$riwi_source_8_90$;
  EXECUTE $riwi_source_8_91$CREATE INDEX "riwi_knowledge_sources_history_idx" ON "riwi_knowledge_sources" USING btree ("updated_at","id");$riwi_source_8_91$;
  EXECUTE $riwi_source_8_92$CREATE INDEX "riwi_learning_signals_history_idx" ON "riwi_learning_signals" USING btree ("created_at","id");$riwi_source_8_92$;
  EXECUTE $riwi_source_8_93$CREATE INDEX "riwi_provider_experiments_actor_created_idx" ON "riwi_provider_experiments" USING btree ("actor_user_id","created_at","id");$riwi_source_8_93$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('0007b0f95a2142bcc0d6df9bc2fb812cee2a6ac02d00f6ef5e71fb40dbf03076',1793370501001);
  -- drizzle/0076_riwi_assessments_and_security_signals.sql SHA256 f9631873a72b6744a719d0b1d3cb8d9840486c3e502af2f563227744154d31e5
  EXECUTE $riwi_source_9_0$-- Forward-only RIWI Assessment Contracts, Owner Policy & Security Signals Migration (ported from LEGACY_RIWI 0045, 0048)$riwi_source_9_0$;
  EXECUTE $riwi_source_9_1$CREATE TYPE "public"."riwi_assessment_policy_state" AS ENUM('candidate', 'approved', 'superseded', 'rejected');$riwi_source_9_1$;
  EXECUTE $riwi_source_9_2$ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "assessment_contract_key" varchar(80);$riwi_source_9_2$;
  EXECUTE $riwi_source_9_3$ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "owner_policy_scope" varchar(100);$riwi_source_9_3$;
  EXECUTE $riwi_source_9_4$ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "owner_policy_version" integer;$riwi_source_9_4$;
  EXECUTE $riwi_source_9_5$ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "teaching_feedback" jsonb;$riwi_source_9_5$;
  EXECUTE $riwi_source_9_6$ALTER TABLE "writing_grade_requests" ADD COLUMN IF NOT EXISTS "task_category" varchar(60);$riwi_source_9_6$;
  EXECUTE $riwi_source_9_7$CREATE TABLE IF NOT EXISTS "riwi_assessment_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" varchar(100) NOT NULL,
  "active_version" integer,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "riwi_assessment_policies_active_version_check" CHECK ("active_version" IS NULL OR "active_version" > 0)
);$riwi_source_9_7$;
  EXECUTE $riwi_source_9_8$CREATE UNIQUE INDEX IF NOT EXISTS "riwi_assessment_policies_scope_uidx" ON "riwi_assessment_policies" USING btree ("scope");$riwi_source_9_8$;
  EXECUTE $riwi_source_9_9$DO $$ BEGIN
 ALTER TABLE "riwi_assessment_policies" ADD CONSTRAINT "riwi_assessment_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;$riwi_source_9_9$;
  EXECUTE $riwi_source_9_10$CREATE TABLE IF NOT EXISTS "riwi_assessment_policy_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "policy_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "state" "riwi_assessment_policy_state" DEFAULT 'candidate' NOT NULL,
  "overlay" jsonb NOT NULL,
  "source_message_hash" varchar(64) NOT NULL,
  "regression_fixture_id" varchar(120),
  "regression_evidence_hash" varchar(64),
  "regression_passed_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "reviewed_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_at" timestamp with time zone,
  CONSTRAINT "riwi_assessment_policy_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "riwi_assessment_policy_versions_message_hash_check" CHECK ("source_message_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "riwi_assessment_policy_versions_regression_hash_check" CHECK ("regression_evidence_hash" IS NULL OR "regression_evidence_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "riwi_assessment_policy_versions_approval_check" CHECK ("state" <> 'approved' OR (
    "regression_fixture_id" IS NOT NULL AND "regression_evidence_hash" IS NOT NULL AND "regression_passed_at" IS NOT NULL AND
    "reviewed_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL
  ))
);$riwi_source_9_10$;
  EXECUTE $riwi_source_9_11$CREATE UNIQUE INDEX IF NOT EXISTS "riwi_assessment_policy_versions_policy_version_uidx" ON "riwi_assessment_policy_versions" USING btree ("policy_id","version");$riwi_source_9_11$;
  EXECUTE $riwi_source_9_12$CREATE UNIQUE INDEX IF NOT EXISTS "riwi_assessment_policy_versions_policy_hash_uidx" ON "riwi_assessment_policy_versions" USING btree ("policy_id","source_message_hash");$riwi_source_9_12$;
  EXECUTE $riwi_source_9_13$CREATE INDEX IF NOT EXISTS "riwi_assessment_policy_versions_state_idx" ON "riwi_assessment_policy_versions" USING btree ("state","created_at","id");$riwi_source_9_13$;
  EXECUTE $riwi_source_9_14$DO $$ BEGIN
 ALTER TABLE "riwi_assessment_policy_versions" ADD CONSTRAINT "riwi_assessment_policy_versions_policy_id_riwi_assessment_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."riwi_assessment_policies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;$riwi_source_9_14$;
  EXECUTE $riwi_source_9_15$DO $$ BEGIN
 ALTER TABLE "riwi_assessment_policy_versions" ADD CONSTRAINT "riwi_assessment_policy_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;$riwi_source_9_15$;
  EXECUTE $riwi_source_9_16$DO $$ BEGIN
 ALTER TABLE "riwi_assessment_policy_versions" ADD CONSTRAINT "riwi_assessment_policy_versions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;$riwi_source_9_16$;
  EXECUTE $riwi_source_9_17$CREATE TYPE "public"."riwi_security_signal_state" AS ENUM('candidate', 'in_review', 'approved_regression', 'rejected', 'developer_action_required');$riwi_source_9_17$;
  EXECUTE $riwi_source_9_18$CREATE TYPE "public"."riwi_security_signal_type" AS ENUM('prompt_injection', 'role_spoof', 'idor', 'tool_injection', 'provider_injection', 'ssrf', 'exfiltration', 'secret_extraction', 'exam_bypass', 'replay', 'toctou', 'knowledge_poisoning', 'assessment_policy_injection', 'prompt_version_downgrade');$riwi_source_9_18$;
  EXECUTE $riwi_source_9_19$CREATE TABLE "riwi_security_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_type" "riwi_security_signal_type" NOT NULL,
	"state" "riwi_security_signal_state" DEFAULT 'candidate' NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_role" "role",
	"route_class" varchar(120) NOT NULL,
	"sanitized_evidence" varchar(500) NOT NULL,
	"regression_fixture_id" varchar(120),
	"regression_evidence_hash" varchar(64),
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_security_signals_fingerprint_check" CHECK ("riwi_security_signals"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "riwi_security_signals_count_check" CHECK ("riwi_security_signals"."occurrence_count" > 0),
	CONSTRAINT "riwi_security_signals_regression_hash_check" CHECK ("riwi_security_signals"."regression_evidence_hash" is null or "riwi_security_signals"."regression_evidence_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "riwi_security_signals_promotion_check" CHECK ("riwi_security_signals"."state" <> 'approved_regression' or (
    "riwi_security_signals"."regression_fixture_id" is not null and "riwi_security_signals"."regression_evidence_hash" is not null and
    "riwi_security_signals"."reviewed_by_user_id" is not null and "riwi_security_signals"."reviewed_at" is not null
  ))
);$riwi_source_9_19$;
  EXECUTE $riwi_source_9_20$ALTER TABLE "riwi_security_signals" ADD CONSTRAINT "riwi_security_signals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;$riwi_source_9_20$;
  EXECUTE $riwi_source_9_21$CREATE UNIQUE INDEX "riwi_security_signals_fingerprint_uidx" ON "riwi_security_signals" USING btree ("fingerprint");$riwi_source_9_21$;
  EXECUTE $riwi_source_9_22$CREATE INDEX "riwi_security_signals_state_seen_idx" ON "riwi_security_signals" USING btree ("state","last_seen_at","id");$riwi_source_9_22$;
  EXECUTE $riwi_source_9_23$CREATE INDEX "riwi_security_signals_type_seen_idx" ON "riwi_security_signals" USING btree ("signal_type","last_seen_at");$riwi_source_9_23$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('f9631873a72b6744a719d0b1d3cb8d9840486c3e502af2f563227744154d31e5',1793370501002);
  -- drizzle/0077_riwi_speaking_sessions_and_activity_indexes.sql SHA256 98582f29ed7a7eff000c440b839ad23e22ac55d290d59f95d46983a1d973cf6a
  EXECUTE $riwi_source_10_0$-- Forward-only RIWI Speaking AI Sessions, Fenced Evaluation & Online Activity Baseline Migration (ported from LEGACY_RIWI 0046, 0047, 0049, 0050)$riwi_source_10_0$;
  EXECUTE $riwi_source_10_1$CREATE TABLE "speaking_ai_session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"prompt_id" uuid NOT NULL,
	"part" "speaking_part" NOT NULL,
	"topic_key" varchar(240) NOT NULL,
	"topic_position" integer NOT NULL,
	"question_position" integer NOT NULL,
	"attempt_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);$riwi_source_10_1$;
  EXECUTE $riwi_source_10_2$CREATE TABLE "speaking_ai_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" varchar(12) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"session_seed" varchar(80) NOT NULL,
	"plan_version" integer DEFAULT 1 NOT NULL,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_item_index" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);$riwi_source_10_2$;
  EXECUTE $riwi_source_10_3$ALTER TABLE "speaking_attempts" ALTER COLUMN "transcript_origin" SET DATA TYPE varchar(20);$riwi_source_10_3$;
  EXECUTE $riwi_source_10_4$ALTER TABLE "speaking_attempts" ADD COLUMN "transcript_raw" text;$riwi_source_10_4$;
  EXECUTE $riwi_source_10_5$ALTER TABLE "speaking_attempts" ADD COLUMN "transcript_edited" boolean DEFAULT false NOT NULL;$riwi_source_10_5$;
  EXECUTE $riwi_source_10_6$ALTER TABLE "speaking_attempts" ADD COLUMN "transcript_edited_at" timestamp with time zone;$riwi_source_10_6$;
  EXECUTE $riwi_source_10_7$ALTER TABLE "speaking_attempts" ADD COLUMN "retry_of_attempt_id" uuid;$riwi_source_10_7$;
  EXECUTE $riwi_source_10_8$ALTER TABLE "speaking_ai_session_items" ADD CONSTRAINT "speaking_ai_session_items_session_id_speaking_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."speaking_ai_sessions"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_10_8$;
  EXECUTE $riwi_source_10_9$ALTER TABLE "speaking_ai_session_items" ADD CONSTRAINT "speaking_ai_session_items_prompt_id_speaking_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."speaking_prompts"("id") ON DELETE restrict ON UPDATE no action;$riwi_source_10_9$;
  EXECUTE $riwi_source_10_10$ALTER TABLE "speaking_ai_session_items" ADD CONSTRAINT "speaking_ai_session_items_attempt_id_speaking_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."speaking_attempts"("id") ON DELETE set null ON UPDATE no action;$riwi_source_10_10$;
  EXECUTE $riwi_source_10_11$ALTER TABLE "speaking_ai_sessions" ADD CONSTRAINT "speaking_ai_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;$riwi_source_10_11$;
  EXECUTE $riwi_source_10_12$CREATE UNIQUE INDEX "speaking_ai_session_items_session_ordinal_uidx" ON "speaking_ai_session_items" USING btree ("session_id","ordinal");$riwi_source_10_12$;
  EXECUTE $riwi_source_10_13$CREATE UNIQUE INDEX "speaking_ai_session_items_session_prompt_uidx" ON "speaking_ai_session_items" USING btree ("session_id","prompt_id");$riwi_source_10_13$;
  EXECUTE $riwi_source_10_14$CREATE UNIQUE INDEX "speaking_ai_session_items_attempt_uidx" ON "speaking_ai_session_items" USING btree ("attempt_id") WHERE "speaking_ai_session_items"."attempt_id" is not null;$riwi_source_10_14$;
  EXECUTE $riwi_source_10_15$CREATE INDEX "speaking_ai_sessions_user_status_idx" ON "speaking_ai_sessions" USING btree ("user_id","status","created_at");$riwi_source_10_15$;
  EXECUTE $riwi_source_10_16$ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_retry_of_attempt_id_speaking_attempts_id_fk" FOREIGN KEY ("retry_of_attempt_id") REFERENCES "public"."speaking_attempts"("id") ON DELETE set null ON UPDATE no action;$riwi_source_10_16$;
  EXECUTE $riwi_source_10_17$ALTER TABLE "speaking_attempts" ADD COLUMN "ai_session_id" uuid;$riwi_source_10_17$;
  EXECUTE $riwi_source_10_18$ALTER TABLE "speaking_attempts" ADD COLUMN "ai_session_item_id" uuid;$riwi_source_10_18$;
  EXECUTE $riwi_source_10_19$ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_ai_session_id_speaking_ai_sessions_id_fk" FOREIGN KEY ("ai_session_id") REFERENCES "public"."speaking_ai_sessions"("id") ON DELETE set null ON UPDATE no action;$riwi_source_10_19$;
  EXECUTE $riwi_source_10_20$ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_ai_session_item_id_speaking_ai_session_items_id_fk" FOREIGN KEY ("ai_session_item_id") REFERENCES "public"."speaking_ai_session_items"("id") ON DELETE set null ON UPDATE no action;$riwi_source_10_20$;
  EXECUTE $riwi_source_10_21$-- Existing last_active_at values were not maintained by authenticated site use.
-- Start the seven-day offline clock at rollout rather than deleting active users' chats.
-- Apply once through the migration journal before enabling the new retention job.
-- Current site already maintains last_active_at. Preserve accepted historical values.$riwi_source_10_21$;
  EXECUTE $riwi_source_10_22$CREATE INDEX IF NOT EXISTS users_online_activity_idx ON users (last_active_at, id);$riwi_source_10_22$;
  EXECUTE $riwi_source_10_23$ALTER TABLE "speaking_attempts" ADD COLUMN "recording_sha256" varchar(64);$riwi_source_10_23$;
  EXECUTE $riwi_source_10_24$ALTER TABLE "speaking_attempts" ADD COLUMN "evaluation_claim_token" uuid;$riwi_source_10_24$;
  EXECUTE $riwi_source_10_25$ALTER TABLE "speaking_attempts" ADD COLUMN "evaluation_claim_expires_at" timestamp with time zone;$riwi_source_10_25$;
  EXECUTE $riwi_source_10_26$ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_recording_sha256_check" CHECK ("recording_sha256" IS NULL OR "recording_sha256" ~ '^[a-f0-9]{64}$');$riwi_source_10_26$;
  EXECUTE $riwi_source_10_27$ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_evaluation_claim_pair_check" CHECK (("evaluation_claim_token" IS NULL) = ("evaluation_claim_expires_at" IS NULL));$riwi_source_10_27$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('98582f29ed7a7eff000c440b839ad23e22ac55d290d59f95d46983a1d973cf6a',1793370501003);
  -- drizzle/0078_riwi_server_only_tables.sql SHA256 e2ba1edf433eb633e238ba1c09b2b262902afc6b587f64d5ad52a71366cfd9c6
  EXECUTE $riwi_source_11_0$-- RIWI tables are accessed only through FastAPI server authorization.
-- Deny direct Data API access; the table owner/server role retains access.
ALTER TABLE public."riwi_action_confirmations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_action_confirmations" FROM PUBLIC;
ALTER TABLE public."riwi_conversation_messages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_conversation_messages" FROM PUBLIC;
ALTER TABLE public."riwi_conversations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_conversations" FROM PUBLIC;
ALTER TABLE public."riwi_knowledge_conflicts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_knowledge_conflicts" FROM PUBLIC;
ALTER TABLE public."riwi_knowledge_sources" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_knowledge_sources" FROM PUBLIC;
ALTER TABLE public."riwi_knowledge_units" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_knowledge_units" FROM PUBLIC;
ALTER TABLE public."riwi_learning_reviews" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_learning_reviews" FROM PUBLIC;
ALTER TABLE public."riwi_learning_signals" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_learning_signals" FROM PUBLIC;
ALTER TABLE public."riwi_provider_experiment_results" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_provider_experiment_results" FROM PUBLIC;
ALTER TABLE public."riwi_provider_experiments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_provider_experiments" FROM PUBLIC;
ALTER TABLE public."riwi_usage_metrics" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_usage_metrics" FROM PUBLIC;
ALTER TABLE public."riwi_assessment_policies" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_assessment_policies" FROM PUBLIC;
ALTER TABLE public."riwi_assessment_policy_versions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_assessment_policy_versions" FROM PUBLIC;
ALTER TABLE public."riwi_security_signals" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."riwi_security_signals" FROM PUBLIC;
ALTER TABLE public."speaking_ai_sessions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."speaking_ai_sessions" FROM PUBLIC;
ALTER TABLE public."speaking_ai_session_items" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."speaking_ai_session_items" FROM PUBLIC;
DO $guard$
DECLARE role_name text; table_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      FOREACH table_name IN ARRAY ARRAY['riwi_action_confirmations','riwi_conversation_messages','riwi_conversations','riwi_knowledge_conflicts','riwi_knowledge_sources','riwi_knowledge_units','riwi_learning_reviews','riwi_learning_signals','riwi_provider_experiment_results','riwi_provider_experiments','riwi_usage_metrics','riwi_assessment_policies','riwi_assessment_policy_versions','riwi_security_signals','speaking_ai_sessions','speaking_ai_session_items'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
      END LOOP;
    END IF;
  END LOOP;
END
$guard$;$riwi_source_11_0$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('e2ba1edf433eb633e238ba1c09b2b262902afc6b587f64d5ad52a71366cfd9c6',1793370501004);
  -- drizzle/0079_riwi_canonical_task_metadata.sql SHA256 f5c3f763fdad955fb47e270222d7ca7eba050a2aba3fc82e02e3b4459b904cb5
  EXECUTE $riwi_source_12_0$-- Canonical subtype is server-owned. Historical prompts remain unclassified.
ALTER TABLE writing_prompts ADD COLUMN IF NOT EXISTS task_category varchar(60);$riwi_source_12_0$;
  INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('f5c3f763fdad955fb47e270222d7ca7eba050a2aba3fc82e02e3b4459b904cb5',1793370501005);
  -- supabase/migrations/20261030230000_mock_hybrid_grading_system.sql SHA256 a2efbff7a359a8bd3180b2ba6cb5cd59113c20383326447b999afdf77ea97681
  EXECUTE $riwi_source_13_0$-- Supabase migration: Mock Hybrid Grading System (P1)
-- Forward-safe, idempotent migration for weekly mock schedules, attempt lifecycle,
-- deterministic Listening/Reading section submissions, Writing answers, Speaking audio,
-- Gemini batch exports/imports, append-only grading revisions, and audit trail.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.mock_schedules (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	mock_test_id uuid NOT NULL REFERENCES public.mock_tests(id) ON DELETE CASCADE,
	weekly_slot varchar(32) NOT NULL,
	starts_at timestamptz NOT NULL,
	ends_at timestamptz NOT NULL,
	timezone varchar(40) DEFAULT 'Asia/Tashkent' NOT NULL,
	policy_version varchar(24) DEFAULT 'v1' NOT NULL,
	published_at timestamptz,
	created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT mock_schedules_window_chk CHECK (ends_at > starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS mock_schedules_test_slot_uq ON public.mock_schedules (mock_test_id, weekly_slot);
CREATE INDEX IF NOT EXISTS mock_schedules_slot_window_idx ON public.mock_schedules (weekly_slot, starts_at, ends_at);

ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES public.mock_schedules(id) ON DELETE SET NULL;
ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS weekly_slot varchar(32);
ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS content_snapshot_hash varchar(64);
ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS active_section_position integer DEFAULT 1 NOT NULL;
ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS section_deadlines jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS mock_attempts_user_weekly_slot_uq ON public.mock_attempts (user_id, weekly_slot) WHERE weekly_slot IS NOT NULL AND status <> 'abandoned';
CREATE INDEX IF NOT EXISTS mock_attempts_user_status_idx ON public.mock_attempts (user_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS public.mock_section_submissions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	attempt_id uuid NOT NULL REFERENCES public.mock_attempts(id) ON DELETE CASCADE,
	skill varchar(16) NOT NULL,
	status varchar(32) DEFAULT 'in_progress' NOT NULL,
	raw_score integer,
	score_max integer,
	band real,
	answers_json jsonb DEFAULT '{}'::jsonb NOT NULL,
	result_details jsonb,
	draft_revision integer DEFAULT 0 NOT NULL,
	answer_hash varchar(64),
	content_version_id uuid REFERENCES public.content_versions(id) ON DELETE SET NULL,
	started_at timestamptz DEFAULT now() NOT NULL,
	deadline_at timestamptz,
	submitted_at timestamptz,
	updated_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT mock_section_submissions_skill_chk CHECK (skill IN ('listening','reading','writing','speaking')),
	CONSTRAINT mock_section_submissions_band_chk CHECK (band IS NULL OR (band >= 0 AND band <= 9))
);
CREATE UNIQUE INDEX IF NOT EXISTS mock_section_submissions_attempt_skill_uq ON public.mock_section_submissions (attempt_id, skill);
CREATE INDEX IF NOT EXISTS mock_section_submissions_skill_status_idx ON public.mock_section_submissions (skill, status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.mock_writing_answers (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	attempt_id uuid NOT NULL REFERENCES public.mock_attempts(id) ON DELETE CASCADE,
	task_type varchar(16) NOT NULL,
	prompt_snapshot_id uuid REFERENCES public.content_versions(id) ON DELETE SET NULL,
	prompt_text text DEFAULT '' NOT NULL,
	content text DEFAULT '' NOT NULL,
	media_ref text,
	media_sha256 varchar(64),
	word_count integer DEFAULT 0 NOT NULL,
	draft_revision integer DEFAULT 0 NOT NULL,
	finalized_at timestamptz,
	sha256 varchar(64),
	updated_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT mock_writing_answers_task_type_chk CHECK (task_type IN ('task1','task2')),
	CONSTRAINT mock_writing_answers_word_count_chk CHECK (word_count >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS mock_writing_answers_attempt_task_uq ON public.mock_writing_answers (attempt_id, task_type);

CREATE TABLE IF NOT EXISTS public.mock_speaking_audio (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	attempt_id uuid NOT NULL REFERENCES public.mock_attempts(id) ON DELETE CASCADE,
	part varchar(8) NOT NULL,
	question_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
	object_key text NOT NULL,
	upload_intent_id uuid REFERENCES public.upload_intents(id) ON DELETE SET NULL,
	codec varchar(64) NOT NULL,
	mime_type varchar(120) DEFAULT 'audio/webm' NOT NULL,
	bytes integer NOT NULL,
	duration_ms integer NOT NULL,
	sha256 varchar(64) NOT NULL,
	capture_status varchar(32) DEFAULT 'finalized' NOT NULL,
	started_at timestamptz,
	ended_at timestamptz,
	finalized_at timestamptz DEFAULT now(),
	created_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT mock_speaking_audio_part_chk CHECK (part IN ('P1','P2','P3')),
	CONSTRAINT mock_speaking_audio_bytes_chk CHECK (bytes > 0),
	CONSTRAINT mock_speaking_audio_duration_chk CHECK (duration_ms >= 0),
	CONSTRAINT mock_speaking_audio_status_chk CHECK (capture_status IN ('recording','finalized','incomplete','needs_review'))
);
CREATE UNIQUE INDEX IF NOT EXISTS mock_speaking_audio_attempt_part_uq ON public.mock_speaking_audio (attempt_id, part);

CREATE TABLE IF NOT EXISTS public.mock_grading_batches (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	batch_code varchar(64) NOT NULL,
	scope varchar(32) NOT NULL,
	section varchar(16) NOT NULL,
	filter_mode varchar(24) DEFAULT 'ungraded' NOT NULL,
	date_from date,
	date_to date,
	created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
	created_at timestamptz DEFAULT now() NOT NULL,
	export_manifest_hash varchar(64) NOT NULL,
	manifest_json jsonb NOT NULL,
	student_alias_map jsonb DEFAULT '{}'::jsonb NOT NULL,
	status varchar(32) DEFAULT 'exported' NOT NULL,
	published_at timestamptz,
	published_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
	CONSTRAINT mock_grading_batches_scope_chk CHECK (scope IN ('assigned','owner')),
	CONSTRAINT mock_grading_batches_section_chk CHECK (section IN ('writing','speaking')),
	CONSTRAINT mock_grading_batches_filter_chk CHECK (filter_mode IN ('ungraded','all')),
	CONSTRAINT mock_grading_batches_status_chk CHECK (status IN ('awaiting_export','exported','imported_draft','needs_review','approved','published','retryable_failure'))
);
CREATE UNIQUE INDEX IF NOT EXISTS mock_grading_batches_code_uq ON public.mock_grading_batches (batch_code);
CREATE INDEX IF NOT EXISTS mock_grading_batches_creator_idx ON public.mock_grading_batches (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mock_grading_revisions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	attempt_id uuid NOT NULL REFERENCES public.mock_attempts(id) ON DELETE CASCADE,
	section varchar(16) NOT NULL,
	batch_id uuid NOT NULL REFERENCES public.mock_grading_batches(id) ON DELETE CASCADE,
	rubric_version varchar(32) NOT NULL,
	source varchar(32) DEFAULT 'gemini_manual' NOT NULL,
	status varchar(32) DEFAULT 'imported_draft' NOT NULL,
	payload_json jsonb NOT NULL,
	raw_gemini_json jsonb,
	payload_sha256 varchar(64) NOT NULL,
	source_sha256 varchar(64) NOT NULL,
	calculated_band real,
	task1_band real,
	task2_band real,
	author_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
	approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
	approved_at timestamptz,
	published_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
	published_at timestamptz,
	supersedes_id uuid REFERENCES public.mock_grading_revisions(id) ON DELETE SET NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT mock_grading_revisions_section_chk CHECK (section IN ('writing','speaking')),
	CONSTRAINT mock_grading_revisions_source_chk CHECK (source IN ('gemini_manual','teacher_revision','owner_revision')),
	CONSTRAINT mock_grading_revisions_status_chk CHECK (status IN ('imported_draft','needs_review','approved','published','superseded')),
	CONSTRAINT mock_grading_revisions_band_chk CHECK (calculated_band IS NULL OR (calculated_band >= 0 AND calculated_band <= 9))
);
CREATE UNIQUE INDEX IF NOT EXISTS mock_grading_revisions_idempotent_import_uq ON public.mock_grading_revisions (batch_id, attempt_id, section, payload_sha256) WHERE source = 'gemini_manual';
CREATE INDEX IF NOT EXISTS mock_grading_revisions_attempt_section_idx ON public.mock_grading_revisions (attempt_id, section, created_at DESC);
CREATE INDEX IF NOT EXISTS mock_grading_revisions_batch_status_idx ON public.mock_grading_revisions (batch_id, status);

CREATE TABLE IF NOT EXISTS public.mock_grading_import_issues (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	batch_id uuid NOT NULL REFERENCES public.mock_grading_batches(id) ON DELETE CASCADE,
	row_number integer,
	attempt_id uuid REFERENCES public.mock_attempts(id) ON DELETE SET NULL,
	student_alias varchar(32),
	error_code varchar(64) NOT NULL,
	details text NOT NULL,
	created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
	created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS mock_grading_import_issues_batch_idx ON public.mock_grading_import_issues (batch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mock_audit_events (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
	attempt_id uuid REFERENCES public.mock_attempts(id) ON DELETE SET NULL,
	batch_id uuid REFERENCES public.mock_grading_batches(id) ON DELETE SET NULL,
	action varchar(80) NOT NULL,
	source_hash varchar(64),
	old_revision_id uuid REFERENCES public.mock_grading_revisions(id) ON DELETE SET NULL,
	new_revision_id uuid REFERENCES public.mock_grading_revisions(id) ON DELETE SET NULL,
	metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
	at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS mock_audit_events_attempt_idx ON public.mock_audit_events (attempt_id, at DESC);
CREATE INDEX IF NOT EXISTS mock_audit_events_batch_idx ON public.mock_audit_events (batch_id, at DESC);$riwi_source_13_0$;
  -- supabase/migrations/20261101134624_mock_speaking_question_captures.sql SHA256 2d4add99e0d45ec3d7df2c443390dc5b2a8e6f88b1b2558379c28eea7f120bb0
  EXECUTE $riwi_source_14_0$-- Additive per-question capture; legacy Part recordings and all educational data remain intact.
CREATE TABLE IF NOT EXISTS public.mock_speaking_question_captures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL REFERENCES public.mock_attempts(id) ON DELETE CASCADE,
 part varchar(8) NOT NULL CHECK (part IN ('P1','P2','P3')),
 question_id uuid NOT NULL,
 question_ids jsonb NOT NULL,
 object_key text NOT NULL,
 codec varchar(64) NOT NULL,
 mime_type varchar(120) NOT NULL,
 bytes integer NOT NULL CHECK (bytes >= 64 AND bytes <= 10485760),
 duration_ms integer NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 600000),
 sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
 capture_status varchar(32) NOT NULL DEFAULT 'finalized' CHECK (capture_status='finalized'),
 transcript_capture jsonb NOT NULL DEFAULT '{"text":"","status":"unavailable"}'::jsonb,
 started_at timestamptz,
 ended_at timestamptz,
 finalized_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mock_question_capture_identity UNIQUE(attempt_id,part,question_id),
 CONSTRAINT mock_question_capture_key UNIQUE(object_key),
 CHECK (jsonb_typeof(question_ids)='array' AND question_ids=jsonb_build_array(question_id::text)),
 CHECK (jsonb_typeof(transcript_capture)='object' AND transcript_capture ?& ARRAY['text','status'] AND
        transcript_capture->>'status' IN ('unavailable','browser_unverified') AND
        jsonb_typeof(transcript_capture->'text')='string' AND
        length(transcript_capture->>'text')<=40000)
);
ALTER TABLE public.mock_speaking_question_captures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mock_speaking_question_captures FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON public.mock_speaking_question_captures FROM anon;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON public.mock_speaking_question_captures FROM authenticated;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN
  GRANT SELECT,INSERT ON public.mock_speaking_question_captures TO service_role;
 END IF;
END $$;
COMMENT ON TABLE public.mock_speaking_question_captures IS 'Private immutable question recordings; browser transcripts are unverified, never certified verbatim.';$riwi_source_14_0$;
  FOR item IN SELECT * FROM riwi_qa_recovery_20261102.manifest
      WHERE source_schema='public' AND source_table<>'api_rate_buckets' ORDER BY source_table LOOP
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE NOWAIT',item.source_schema,item.source_table);
    SELECT coalesce(array_agg(a.attname::text),'{}'::text[]) INTO omitted
      FROM pg_attribute a WHERE a.attrelid=format('%I.%I',item.source_schema,item.source_table)::regclass
      AND a.attnum>0 AND NOT a.attisdropped AND NOT EXISTS
        (SELECT 1 FROM jsonb_array_elements(item.schema_definition->'columns') old_col
         WHERE old_col->>'name'=a.attname);
    EXECUTE format('SELECT count(*),md5(coalesce(string_agg(md5((to_jsonb(t)-$1)::text),%L ORDER BY md5((to_jsonb(t)-$1)::text)),%L)) FROM %I.%I t',
      '','',item.source_schema,item.source_table) INTO row_count_now,digest_now USING omitted;
    IF row_count_now<>item.row_count OR digest_now<>item.row_digest THEN
      RAISE EXCEPTION 'Historical data preservation check failed for %.%',item.source_schema,item.source_table;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM drizzle.__drizzle_migrations)<>79 THEN RAISE EXCEPTION 'Unexpected final journal count'; END IF;
END
$riwi_qa_upgrade_8054d759$;
