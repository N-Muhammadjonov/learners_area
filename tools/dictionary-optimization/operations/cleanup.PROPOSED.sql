-- REVIEW COPY ONLY. Nothing in this file has been executed.
-- Candidate change LA-DICTIONARY-LEGACY-20261026.
-- A future approved revision may replace the unconditional stop only after every
-- gate in evidence/gates.json has real PASS receipts and the owner approves.
-- No trigger, policy, constraint, index definition, Worker or bucket is removed.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  RAISE EXCEPTION 'DRAFT_NOT_APPROVED_BACKUP_AND_QA_GATES_REQUIRED';
END $$;

-- The existing publisher uses the same transaction-scoped advisory lock.
SELECT pg_advisory_xact_lock(387384);
LOCK TABLE public.dictionary_channels, public.dictionary_publish_jobs,
  public.dictionary_releases IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE ONLY public.dictionary_search_terms IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  legacy constant text := 'rel-v1-a834010a6ccc72c8b3cd8db9';
  active constant text := 'rel-v1-977bce7f8dab7e773955238e';
  previous constant text := 'rel-v1-cfadf47e87701f627f3270ce';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.dictionary_channels WHERE name='stable'
      AND active_release_id=active AND previous_release_id=previous)
  THEN RAISE EXCEPTION 'channel_drift'; END IF;
  IF EXISTS (SELECT 1 FROM public.dictionary_publish_jobs
      WHERE phase NOT IN ('complete','failed') OR base_release_id=legacy OR candidate_release_id=legacy)
  THEN RAISE EXCEPTION 'publish_dependency'; END IF;
  IF EXISTS (SELECT 1 FROM public.dictionary_channels
      WHERE active_release_id=legacy OR previous_release_id=legacy)
  THEN RAISE EXCEPTION 'protected_release'; END IF;
  IF (SELECT count(*) FROM public.dictionary_releases r
      JOIN public.dictionary_search_indexes i ON i.release_id=r.id
      WHERE r.id IN (active,previous) AND r.state='validated' AND r.delivery='r2-worker-v1')<>2
  THEN RAISE EXCEPTION 'protected_worker_release_missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dictionary_releases WHERE id=active
      AND manifest_sha='3e2f1638bc4127da5fb359093ea97aeacdeebdc2d4d293dc161e174be4ad845c')
      OR NOT EXISTS (SELECT 1 FROM public.dictionary_releases WHERE id=previous
      AND manifest_sha='756134d493381bae1bbf66f3c910f3590da1ef0ad2a8b1b92fcede2229eedfdf')
  THEN RAISE EXCEPTION 'manifest_drift'; END IF;
  IF EXISTS (SELECT 1 FROM public.dictionary_entries
      WHERE storage_release=legacy AND release_id<>legacy)
  THEN RAISE EXCEPTION 'shared_storage_dependency'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
      WHERE contype='f' AND confrelid='public.dictionary_search_terms'::regclass)
      OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w
      ON d.classid='pg_rewrite'::regclass AND d.objid=w.oid
      WHERE d.refclassid='pg_class'::regclass AND d.refobjid='public.dictionary_search_terms'::regclass
      AND w.ev_class<>'public.dictionary_search_terms'::regclass)
      OR EXISTS (SELECT 1 FROM pg_inherits
      WHERE inhparent='public.dictionary_search_terms'::regclass OR inhrelid='public.dictionary_search_terms'::regclass)
  THEN RAISE EXCEPTION 'table_dependency_drift'; END IF;
  IF (SELECT count(*) FROM public.dictionary_search_terms)<>1201156
      OR EXISTS (SELECT 1 FROM public.dictionary_search_terms WHERE release_id<>legacy)
      OR (SELECT count(*) FROM public.dictionary_search_terms WHERE direction='EN')<>65669
      OR (SELECT count(*) FROM public.dictionary_search_terms WHERE direction='UZ')<>1135487
  THEN RAISE EXCEPTION 'term_inventory_drift'; END IF;
  IF (SELECT count(*) FROM public.dictionary_entries)<>256986
      OR (SELECT count(*) FROM public.dictionary_sense_mappings)<>3851
  THEN RAISE EXCEPTION 'identity_inventory_drift'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.dictionary_search_terms'::regclass
      AND tgname='dictionary_terms_immutable' AND tgenabled='O'
      AND tgfoid='public.dictionary_immutable_release()'::regprocedure)
      OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.dictionary_releases'::regclass
      AND tgname='dictionary_registry_immutable' AND tgenabled='O'
      AND tgfoid='public.dictionary_immutable_registry()'::regprocedure)
  THEN RAISE EXCEPTION 'immutability_guard_missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dictionary_releases
      WHERE id=legacy AND state='validated' AND delivery='legacy')
  THEN RAISE EXCEPTION 'legacy_release_drift'; END IF;

  -- Use the existing guarded lifecycle transition. Its registry trigger must stay enabled.
  -- Retired registry rows are intentionally irreversible. Do not promise an in-place unretire.
  UPDATE public.dictionary_releases SET state='retired' WHERE id=legacy;
END $$;

-- All rows belong to the now-retired legacy release. No CASCADE and no identity reset.
-- TRUNCATE does not fire row DELETE triggers; retirement above is required first.
TRUNCATE TABLE ONLY public.dictionary_search_terms CONTINUE IDENTITY RESTRICT;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.dictionary_search_terms)
      OR (SELECT count(*) FROM public.dictionary_entries)<>256986
      OR (SELECT count(*) FROM public.dictionary_sense_mappings)<>3851
  THEN RAISE EXCEPTION 'post_cleanup_invariant_failed'; END IF;
END $$;
COMMIT;

-- Run only AFTER the approved transaction commits:
SELECT pg_database_size(current_database()) AS database_bytes,
  pg_total_relation_size('public.dictionary_search_terms') AS legacy_search_bytes;
