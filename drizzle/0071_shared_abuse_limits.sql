-- 0070 is reserved for the preserved student-learning feature branch.
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
END $$;
