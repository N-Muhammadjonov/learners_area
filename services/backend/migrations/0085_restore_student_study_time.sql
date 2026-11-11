-- Restore server-recorded study activity without modifying legacy reward or learning data.
-- New intervals begin when users interact after deployment. No historical backfill.
CREATE TABLE IF NOT EXISTS public.study_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 module text NOT NULL CHECK(module IN ('reading','listening','writing','speaking','vocabulary','grammar','video','mocks','courses')),
 last_at timestamptz NOT NULL DEFAULT now(), last_sequence integer NOT NULL DEFAULT 0,
 active boolean NOT NULL DEFAULT false, closed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS study_sessions_user_idx ON public.study_sessions(user_id,last_at);
CREATE TABLE IF NOT EXISTS public.study_intervals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES public.study_sessions(id) ON DELETE CASCADE,
 sequence integer NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL,
 seconds numeric(8,3) NOT NULL CHECK(seconds>0 AND seconds<=45),
 CHECK(ended_at>started_at AND ended_at-started_at<=interval '45 seconds'), UNIQUE(session_id,sequence)
);
CREATE INDEX IF NOT EXISTS study_intervals_user_end_idx ON public.study_intervals(user_id,ended_at DESC);
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_intervals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_sessions,public.study_intervals FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON public.study_sessions,public.study_intervals FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON public.study_sessions,public.study_intervals FROM authenticated;
 END IF;
END $$;
