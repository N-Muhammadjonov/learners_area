-- source_ref links many chunks to one model essay. Slots provide a hard,
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
FOR EACH ROW EXECUTE FUNCTION public.assign_writing_pattern_model_slot();
