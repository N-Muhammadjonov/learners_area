-- Additive ownership-scoped folder links and server-timed study intervals.
CREATE TABLE IF NOT EXISTS public.vocab_folder_entries (
 folder_id uuid NOT NULL REFERENCES public.vocab_folders(id) ON DELETE CASCADE,
 entry_id uuid NOT NULL REFERENCES public.user_vocabulary(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, PRIMARY KEY(folder_id,entry_id)
);
CREATE INDEX IF NOT EXISTS vocab_folder_entries_user_entry_idx ON public.vocab_folder_entries(user_id,entry_id);
INSERT INTO public.vocab_folder_entries(folder_id,entry_id,user_id)
SELECT v.folder_id,v.id,v.user_id FROM public.user_vocabulary v JOIN public.vocab_folders f ON f.id=v.folder_id AND f.user_id=v.user_id
WHERE v.folder_id IS NOT NULL ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.link_owned_vocab_folder() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.folder_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM vocab_folders WHERE id=NEW.folder_id AND user_id=NEW.user_id) THEN
   RAISE EXCEPTION 'folder_not_owned' USING ERRCODE='23514';
  END IF;
  INSERT INTO vocab_folder_entries(folder_id,entry_id,user_id) VALUES(NEW.folder_id,NEW.id,NEW.user_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_vocabulary_folder_link ON public.user_vocabulary;
CREATE TRIGGER user_vocabulary_folder_link AFTER INSERT OR UPDATE OF folder_id ON public.user_vocabulary
FOR EACH ROW EXECUTE FUNCTION public.link_owned_vocab_folder();
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
ALTER TABLE public.vocab_folder_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_intervals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vocab_folder_entries,public.study_sessions,public.study_intervals FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON public.vocab_folder_entries,public.study_sessions,public.study_intervals FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON public.vocab_folder_entries,public.study_sessions,public.study_intervals FROM authenticated;
 END IF;
END $$;
