-- Add learner-selected duration without rewriting or deleting existing 30-day cycles.
ALTER TABLE study_plan_30_cycles
    ADD COLUMN duration_days smallint NOT NULL DEFAULT 30
    CONSTRAINT study_plan_30_cycles_duration_days_check
    CHECK (duration_days IN (7, 30));

COMMENT ON COLUMN study_plan_30_cycles.duration_days IS
    'Learner-selected 7 or 30 sequential days; existing cycles default to 30.';
