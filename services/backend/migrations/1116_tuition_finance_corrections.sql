-- 1116: Forward-only corrections to the tuition subledger (FIN-04 … FIN-12).
--
-- `1115_tuition_finance.sql` is committed, tracked by
-- `services/backend/tests/migration-additions.json` and may already have been applied by a
-- reviewer environment, so it is NOT edited. Everything 1115 got wrong is corrected here in
-- front of it. This migration is additive and non-destructive: it adds constraints, indexes
-- and tables, drops nothing, rewrites no row, and takes no long lock beyond creating indexes
-- on a table that is empty in every environment (1115 shipped in this same release).
--
-- FIN-04  one live tuition installment per contract and period
-- FIN-05  discounts freeze once the charge is posted; later relief is a credit note
-- FIN-08  a refund is a new current-period outgoing payment, never an edit of an old cash day
-- FIN-09  a duplicate is only a duplicate when every financial semantic key matches
-- FIN-12  immutable sensitive-action audit, per-currency balance, transactional outbox

-- ─────────────────────── FIN-04: charge business key ───────────────────────
-- Granularity decision: ONE tuition installment per (contract, billing period). A reversal
-- or a credit is a separate explicit document and is excluded, and a superseded charge
-- (reversed / credited) no longer occupies the slot, so a corrected re-issue is possible.
-- NULL contract_id means an ad-hoc charge outside any contract and is not covered here.
CREATE UNIQUE INDEX IF NOT EXISTS tuition_charges_one_live_installment_per_period
    ON tuition_charges (contract_id, period_key)
    WHERE contract_id IS NOT NULL
      AND is_reversal = false
      AND status NOT IN ('reversed', 'credited');
--> statement-breakpoint

-- ─────────────────────── FIN-05: credit notes ───────────────────────
-- After a charge is posted its commercial terms are frozen. Relief is a credit note: its own
-- document, its own approval, its own balanced journal entry, and a link back to the charge
-- it relieves. A discount row can never be mutated to achieve the same effect.
CREATE TABLE IF NOT EXISTS tuition_credit_notes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    charge_id uuid NOT NULL REFERENCES tuition_charges(id) ON DELETE RESTRICT,
    contract_id uuid REFERENCES tuition_contracts(id) ON DELETE SET NULL,
    student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    period_key varchar(7) NOT NULL,
    currency_code varchar(3) NOT NULL DEFAULT 'UZS',
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    status varchar(10) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','approved','posted','reversed')),
    reason varchar(300) NOT NULL,
    requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_at timestamptz,
    posted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tuition_credit_notes_charge_idx
    ON tuition_credit_notes(charge_id);
CREATE UNIQUE INDEX IF NOT EXISTS tuition_credit_notes_one_live_per_charge_period
    ON tuition_credit_notes (charge_id, period_key)
    WHERE status NOT IN ('reversed');
--> statement-breakpoint

-- The charge's own discount is frozen the moment it posts: the posted net is the obligation.
ALTER TABLE tuition_charges
    ADD COLUMN IF NOT EXISTS discount_locked_at timestamptz,
    ADD COLUMN IF NOT EXISTS discount_locked_minor bigint;
--> statement-breakpoint

-- ─────────────────────── FIN-08: refunds as outgoing payments ───────────────────────
-- A refund of an old receipt is NOT a rewrite of that day's cash. It is a new outgoing
-- payment with its own effective date and its own period, so day close stays comparable:
-- expected cash = opening + receipts - confirmed cash refunds + approved adjustments.
ALTER TABLE tuition_refunds
    ADD COLUMN IF NOT EXISTS effective_on date NOT NULL DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS effective_period varchar(7),
    ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS settled_at timestamptz,
    ADD COLUMN IF NOT EXISTS failure_reason varchar(300);
--> statement-breakpoint
-- Request / approval / provider settlement / failure are distinct states, so a refund that
-- the provider has not settled can never be reported as money out of the door.
DO $refund_states$
BEGIN
    -- `information_schema` describes the whole database, so without a schema filter this
    -- guard was answered by unrelated schemas: once any schema in the database had finished
    -- the chain it became true, and the ALTER below then ran against the current schema,
    -- where `status` does not exist until 1118 adds it. Scope it to the schema being migrated.
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema()
                 AND table_name = 'tuition_refunds' AND column_name = 'status') THEN
        ALTER TABLE tuition_refunds DROP CONSTRAINT IF EXISTS tuition_refunds_status_check;
        ALTER TABLE tuition_refunds ADD CONSTRAINT tuition_refunds_status_check
            CHECK (status IN ('requested','approved','settled','failed','rejected'));
    END IF;
END $refund_states$;
--> statement-breakpoint

-- ─────────────────────── FIN-09: replay identity ───────────────────────
-- A retry is a retry only when the canonical identity fingerprint matches. Storing the
-- fingerprint next to the key makes a mismatched reuse auditable instead of silently
-- returning somebody else's payment.
ALTER TABLE tuition_payments
    ADD COLUMN IF NOT EXISTS identity_fingerprint varchar(64);
--> statement-breakpoint

-- ─────────────────────── FIN-12: audit, currency, outbox ───────────────────────
-- Immutable record of every sensitive financial action: who, why, when, from which request.
CREATE TABLE IF NOT EXISTS finance_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action varchar(60) NOT NULL,
    subject_type varchar(40) NOT NULL,
    subject_id uuid,
    period_key varchar(7),
    amount_minor bigint,
    currency_code varchar(3) NOT NULL DEFAULT 'UZS',
    reason varchar(300),
    request_id varchar(80),
    detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS finance_audit_events_subject_idx
    ON finance_audit_events(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS finance_audit_events_period_idx
    ON finance_audit_events(period_key);
--> statement-breakpoint

-- External side effects (provider confirmations, parent notifications, exports) are published
-- from the same transaction that wrote the money, so a crash cannot lose one or fake one.
CREATE TABLE IF NOT EXISTS finance_outbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    topic varchar(60) NOT NULL,
    aggregate_type varchar(40) NOT NULL,
    aggregate_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    last_error varchar(500)
);
CREATE INDEX IF NOT EXISTS finance_outbox_events_unpublished_idx
    ON finance_outbox_events(created_at) WHERE published_at IS NULL;
--> statement-breakpoint

-- ─────────────────────────── access policy ───────────────────────────
-- Identical posture to 1115: RLS on, nothing granted to the Supabase API roles.
DO $access1116$
DECLARE
    api_role name;
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'tuition_credit_notes','finance_audit_events','finance_outbox_events']::text[] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
        FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
                EXECUTE format('REVOKE ALL ON %I FROM %I', table_name, api_role);
            END IF;
        END LOOP;
    END LOOP;
END $access1116$;
