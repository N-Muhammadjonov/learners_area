-- Owner-only 5-minute presence history; records start at deployment, never backfilled.
CREATE TABLE IF NOT EXISTS public.site_presence_samples (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bucket_start timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,bucket_start)
);
CREATE INDEX IF NOT EXISTS site_presence_samples_bucket_idx ON public.site_presence_samples (bucket_start DESC);
ALTER TABLE public.site_presence_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_presence_samples FROM PUBLIC;
-- Explicitly deny PUBLIC. Newly created tables do not grant SELECT to any role;
-- RLS additionally denies reads even if the schema's defaults later change.
