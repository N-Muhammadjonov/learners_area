-- Expand 30-day study plan task kinds for owner retention / article / video.
-- Backward compatible: existing six-kind plans remain unchanged.
-- Repeatable across the backend migration runner and Supabase deployment.
DO $owner_curriculum_task_constraints$
DECLARE
    kind_definition text;
    slot_definition text;
BEGIN
    SELECT pg_get_constraintdef(c.oid)
      INTO kind_definition
      FROM pg_constraint c
     WHERE c.conrelid = 'public.study_plan_30_tasks'::regclass
       AND c.conname = 'study_plan_30_tasks_kind_check';

    SELECT pg_get_constraintdef(c.oid)
      INTO slot_definition
      FROM pg_constraint c
     WHERE c.conrelid = 'public.study_plan_30_tasks'::regclass
       AND c.conname = 'study_plan_30_tasks_slot_check';

    IF kind_definition IS NULL OR slot_definition IS NULL THEN
        RAISE EXCEPTION 'Study-plan task constraint layout is unexpected';
    END IF;

    IF position('retention' IN kind_definition) > 0
       AND position('7' IN slot_definition) > 0 THEN
        RETURN;
    END IF;

    IF position('retention' IN kind_definition) > 0
       OR position('7' IN slot_definition) > 0 THEN
        RAISE EXCEPTION 'Study-plan task constraint migration is partially applied';
    END IF;

    ALTER TABLE public.study_plan_30_tasks
        DROP CONSTRAINT study_plan_30_tasks_kind_check,
        DROP CONSTRAINT study_plan_30_tasks_slot_check;

    ALTER TABLE public.study_plan_30_tasks
        ADD CONSTRAINT study_plan_30_tasks_kind_check
            CHECK (kind IN (
                'grammar', 'reading', 'listening', 'writing', 'speaking',
                'vocabulary', 'retention', 'article', 'video'
            )),
        ADD CONSTRAINT study_plan_30_tasks_slot_check
            CHECK (slot BETWEEN 0 AND 7);
END;
$owner_curriculum_task_constraints$;
