-- Isolated 30-day sequenced learning plans; keep legacy 7/30-day schedules unchanged.
-- Apply with the backend migration runner before enabling the new API.
CREATE TABLE study_plan_30_cycles (
    id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    started_on date NOT NULL,
    timezone text NOT NULL,
    cefr_level text NOT NULL CHECK (cefr_level IN ('A0','A1','A2','B1','B2','C1','C2')),
    current_day smallint NOT NULL DEFAULT 1 CHECK (current_day BETWEEN 1 AND 30),
    opened_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE study_plan_30_tasks (
    cycle_id uuid NOT NULL REFERENCES study_plan_30_cycles(id) ON DELETE CASCADE,
    day_number smallint NOT NULL CHECK (day_number BETWEEN 1 AND 30),
    slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 5),
    kind text NOT NULL CHECK (kind IN ('grammar','reading','listening','writing','speaking','vocabulary')),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 350),
    href text NOT NULL CHECK (left(href,5)='/app/'),
    source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
    minutes smallint NOT NULL CHECK (minutes BETWEEN 5 AND 90),
    stage_index smallint CHECK (stage_index BETWEEN 0 AND 3),
    block_weights jsonb,
    completed_at timestamptz,
    proof jsonb,
    PRIMARY KEY (cycle_id,day_number,slot),
    UNIQUE (cycle_id,day_number,kind),
    CHECK ((kind='grammar')=(stage_index IS NOT NULL AND block_weights IS NOT NULL)),
    CHECK ((completed_at IS NULL AND proof IS NULL) OR completed_at IS NOT NULL)
);

CREATE INDEX study_plan_30_pending ON study_plan_30_tasks(cycle_id,day_number)
    WHERE completed_at IS NULL;

ALTER TABLE study_plan_30_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plan_30_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON study_plan_30_cycles, study_plan_30_tasks FROM PUBLIC;

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON study_plan_30_cycles, study_plan_30_tasks FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
