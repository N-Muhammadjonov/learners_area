CREATE TABLE IF NOT EXISTS academy_payroll_rules (
    id uuid PRIMARY KEY,
    teacher_user_id uuid NOT NULL REFERENCES users(id),
    starts_on date NOT NULL,
    ends_on date,
    monthly_minor bigint NOT NULL CHECK (monthly_minor >= 0),
    session_minor bigint NOT NULL CHECK (session_minor >= 0),
    hourly_minor bigint NOT NULL CHECK (hourly_minor >= 0),
    revenue_bps integer NOT NULL CHECK (revenue_bps BETWEEN 0 AND 10000),
    create_fingerprint varchar(64) NOT NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (teacher_user_id, starts_on),
    CHECK (ends_on IS NULL OR ends_on >= starts_on),
    CHECK (monthly_minor > 0 OR session_minor > 0 OR hourly_minor > 0 OR revenue_bps > 0),
    CHECK (session_minor = 0 OR hourly_minor = 0)
);
CREATE TABLE IF NOT EXISTS academy_payroll_revenue (
    journal_transaction_id uuid PRIMARY KEY REFERENCES finance_journal_entries(transaction_id),
    session_id uuid NOT NULL,
    teacher_user_id uuid NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (session_id, teacher_user_id)
      REFERENCES academy_session_teachers(session_id, teacher_user_id)
);
CREATE INDEX IF NOT EXISTS academy_payroll_revenue_teacher_session_idx
    ON academy_payroll_revenue(teacher_user_id, session_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS academy_payroll_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_user_id uuid NOT NULL REFERENCES users(id),
    period_key varchar(7) NOT NULL,
    accrued_minor bigint NOT NULL CHECK (accrued_minor > 0),
    calculation jsonb NOT NULL,
    accrual_transaction_id uuid NOT NULL REFERENCES finance_journal_entries(transaction_id),
    finalized_by uuid REFERENCES users(id) ON DELETE SET NULL,
    finalized_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (teacher_user_id, period_key)
);
CREATE TABLE IF NOT EXISTS academy_payroll_events (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES academy_payroll_runs(id),
    kind varchar(12) NOT NULL CHECK (kind IN ('adjustment','payout')),
    amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
    period_key varchar(7) NOT NULL,
    transaction_id uuid NOT NULL REFERENCES finance_journal_entries(transaction_id),
    reference varchar(160) NOT NULL CHECK (btrim(reference) <> ''),
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (kind = 'adjustment' OR amount_minor > 0)
);
CREATE INDEX IF NOT EXISTS academy_payroll_events_run_idx ON academy_payroll_events(run_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS academy_payroll_bank_reference_idx
    ON academy_payroll_events(lower(reference)) WHERE kind='payout';
--> statement-breakpoint
ALTER TABLE academy_payroll_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_payroll_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_payroll_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON academy_payroll_rules, academy_payroll_revenue, academy_payroll_runs, academy_payroll_events FROM PUBLIC;
DO $academy_payroll_access$
DECLARE api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON academy_payroll_rules, academy_payroll_revenue, academy_payroll_runs, academy_payroll_events FROM %I', api_role);
        END IF;
    END LOOP;
END $academy_payroll_access$;
