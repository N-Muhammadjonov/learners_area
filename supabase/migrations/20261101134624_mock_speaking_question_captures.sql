-- Additive per-question capture; legacy Part recordings and all educational data remain intact.
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
COMMENT ON TABLE public.mock_speaking_question_captures IS 'Private immutable question recordings; browser transcripts are unverified, never certified verbatim.';
