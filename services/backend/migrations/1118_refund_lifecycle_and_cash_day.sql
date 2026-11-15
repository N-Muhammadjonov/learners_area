-- 1118: refund lifecycle + cash-day reconciliation (FIN-08).
--
-- Two defects are corrected here, both forward-only and non-destructive.
--
-- 1. A refund had no states. Inserting a row into `tuition_refunds` meant the money was out
--    of the door, so a provider refund that had not settled, or one the owner had not
--    approved, was indistinguishable from cash already handed back.
-- 2. A cash day closed against GROSS receipts only. Opening balance, refunds paid out on
--    that day and approved adjustments were invisible, so every day with a refund closed with
--    a false variance.
--
-- `tuition_refunds.status` defaults to 'settled' on purpose: every row that exists before
-- this migration was already posted to the journal and the money already moved, so backfilling
-- anything else would misreport history.

ALTER TABLE tuition_refunds
    ADD COLUMN IF NOT EXISTS status varchar(12) NOT NULL DEFAULT 'settled';
--> statement-breakpoint
ALTER TABLE tuition_refunds DROP CONSTRAINT IF EXISTS tuition_refunds_status_check;
ALTER TABLE tuition_refunds ADD CONSTRAINT tuition_refunds_status_check
    CHECK (status IN ('requested','approved','settled','failed','rejected'));
--> statement-breakpoint
-- Only a settled refund is money out of the door. One partial index keeps the cash-day
-- reconciliation a cheap scan instead of a filter over all history.
CREATE INDEX IF NOT EXISTS tuition_refunds_settled_effective_idx
    ON tuition_refunds(effective_on) WHERE status = 'settled' AND method = 'cash';
--> statement-breakpoint

-- ─────────────────────── cash day reconciliation ───────────────────────
ALTER TABLE cash_day_closes
    ADD COLUMN IF NOT EXISTS opening_minor bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS receipts_minor bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refunds_minor bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS adjustments_minor bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
-- `expected_minor >= 0` no longer holds once a day can pay out a refund of an older receipt
-- with no receipts of its own: the drawer then legitimately needs cash brought in, and a
-- negative expectation is exactly the signal the cashier must explain. Dropping a CHECK
-- changes no row. `counted_minor >= 0` stays: you cannot count negative cash.
ALTER TABLE cash_day_closes DROP CONSTRAINT IF EXISTS cash_day_closes_expected_minor_check;
--> statement-breakpoint

-- Approved intraday cash movements that are neither a receipt nor a refund: float brought in
-- or taken out, a till correction, a bank withdrawal. Only approved adjustments count.
CREATE TABLE IF NOT EXISTS cash_day_adjustments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_date date NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
    reason varchar(300) NOT NULL,
    requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_day_adjustments_date_idx
    ON cash_day_adjustments(business_date);
--> statement-breakpoint

DO $access1118$
DECLARE
    api_role name;
BEGIN
    EXECUTE 'ALTER TABLE cash_day_adjustments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON cash_day_adjustments FROM PUBLIC';
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON cash_day_adjustments FROM %I', api_role);
        END IF;
    END LOOP;
END $access1118$;
