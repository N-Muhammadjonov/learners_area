-- Operational function only; uses 0071 counters and stores no learner content.
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
END $$;
