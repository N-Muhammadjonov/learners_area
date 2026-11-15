-- 1115: Tuition subledger + append-only double-entry journal.
--
-- Two deliberately separate layers (see docs/architecture/DOMAIN_CONTRACTS.md):
--   1. the operational accounts-receivable subledger: contracts, discounts, charges,
--      payments, allocations, refunds and receipts;
--   2. a general-ledger-ready journal: immutable, balanced debit/credit lines grouped by
--      `transaction_id`, with reversal pairs instead of in-place corrections.
--
-- Money rule: every total is `bigint` in the currency's smallest unit. For UZS the
-- smallest unit in circulation is 1 som, so 800000 = 800,000 UZS. No float, ever.
--
-- This migration is additive: it creates new tables only, touches no existing table and
-- performs no data move. Existing billing stubs (products/plans/prices/subscriptions/
-- payments) are left untouched and remain behind BILLING_ENABLED.

-- ─────────────────────────── 1. Chart of accounts ───────────────────────────
-- Illustrative operating accounts. `statutory_code` stays NULL until the buyer maps each
-- account to their own approved chart of accounts; no Uzbek statutory number is invented.
CREATE TABLE IF NOT EXISTS finance_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(40) NOT NULL UNIQUE,
    name varchar(120) NOT NULL,
    kind varchar(20) NOT NULL CHECK (kind IN ('asset','liability','income','contra_income','expense')),
    normal_side varchar(6) NOT NULL CHECK (normal_side IN ('debit','credit')),
    currency_code varchar(3) NOT NULL DEFAULT 'UZS',
    statutory_code varchar(40),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_accounts FROM PUBLIC;
--> statement-breakpoint
INSERT INTO finance_accounts(code,name,kind,normal_side) VALUES
    ('cash_on_hand','Cash on hand','asset','debit'),
    ('bank_clearing','Bank clearing','asset','debit'),
    ('accounts_receivable','Accounts receivable','asset','debit'),
    ('customer_advance','Customer advance (unallocated payments)','liability','credit'),
    ('deferred_tuition_revenue','Deferred tuition revenue','liability','credit'),
    ('tuition_revenue','Tuition revenue','income','credit'),
    ('scholarship_discounts','Scholarship discounts','contra_income','debit'),
    ('refund_payable','Refund payable','liability','credit'),
    ('salary_expense','Salary expense','expense','debit'),
    ('salary_payable','Salary payable','liability','credit'),
    ('payment_fees_expense','Payment provider fees','expense','debit')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- ─────────────────────────── 2. Journal (append-only) ───────────────────────
CREATE TABLE IF NOT EXISTS finance_journal_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id uuid NOT NULL,
    source_type varchar(30) NOT NULL,
    source_id uuid NOT NULL,
    student_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    memo varchar(200),
    period_key varchar(7),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_journal_entries_transaction_idx
    ON finance_journal_entries(transaction_id);
CREATE INDEX IF NOT EXISTS finance_journal_entries_source_idx
    ON finance_journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS finance_journal_entries_period_idx
    ON finance_journal_entries(period_key, occurred_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS finance_journal_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id uuid NOT NULL,
    entry_id uuid NOT NULL REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
    account_id uuid NOT NULL REFERENCES finance_accounts(id) ON DELETE RESTRICT,
    direction varchar(6) NOT NULL CHECK (direction IN ('debit','credit')),
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency_code varchar(3) NOT NULL DEFAULT 'UZS',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_journal_lines_transaction_idx
    ON finance_journal_lines(transaction_id);
CREATE INDEX IF NOT EXISTS finance_journal_lines_account_idx
    ON finance_journal_lines(account_id, created_at);
--> statement-breakpoint
-- Invariant: every journal transaction balances. Enforced in the database at COMMIT, so a
-- half-written entry can never become visible history.
CREATE OR REPLACE FUNCTION finance_journal_balance_guard() RETURNS trigger AS $guard$
DECLARE
    debit_total bigint;
    credit_total bigint;
BEGIN
    SELECT coalesce(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0),
           coalesce(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0)
      INTO debit_total, credit_total
      FROM finance_journal_lines
     WHERE transaction_id = NEW.transaction_id;
    IF debit_total <> credit_total THEN
        RAISE EXCEPTION 'unbalanced_journal_entry:%', NEW.transaction_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END $guard$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_journal_balance_deferred ON finance_journal_lines;
CREATE CONSTRAINT TRIGGER finance_journal_balance_deferred
    AFTER INSERT ON finance_journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION finance_journal_balance_guard();
--> statement-breakpoint
-- Invariant: posted history is never rewritten. Corrections happen as new reversing
-- documents that reference `original_entry_id`, so the audit trail survives.
CREATE OR REPLACE FUNCTION finance_journal_immutable_guard() RETURNS trigger AS $immutable$
BEGIN
    RAISE EXCEPTION 'finance_journal_is_append_only'
        USING ERRCODE = 'object_not_in_prerequisite_state';
END $immutable$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS finance_journal_lines_append_only ON finance_journal_lines;
CREATE TRIGGER finance_journal_lines_append_only
    BEFORE UPDATE OR DELETE ON finance_journal_lines
    FOR EACH STATEMENT EXECUTE FUNCTION finance_journal_immutable_guard();
DROP TRIGGER IF EXISTS finance_journal_entries_append_only ON finance_journal_entries;
CREATE TRIGGER finance_journal_entries_append_only
    BEFORE UPDATE OR DELETE ON finance_journal_entries
    FOR EACH STATEMENT EXECUTE FUNCTION finance_journal_immutable_guard();
--> statement-breakpoint

-- ─────────────────────────── 3. Tuition contracts ───────────────────────────
-- A contract is the signed commercial obligation. Catalogue price changes must never
-- retro-edit an existing contract: the contract carries its own price terms and version.
CREATE TABLE IF NOT EXISTS tuition_contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
    status varchar(12) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','approved','active','completed','cancelled')),
    currency_code varchar(3) NOT NULL DEFAULT 'UZS',
    monthly_amount_minor bigint NOT NULL CHECK (monthly_amount_minor >= 0),
    term_months integer NOT NULL DEFAULT 1 CHECK (term_months BETWEEN 1 AND 120),
    starts_on date NOT NULL,
    ends_on date,
    version integer NOT NULL DEFAULT 1,
    supersedes_contract_id uuid REFERENCES tuition_contracts(id) ON DELETE SET NULL,
    approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_at timestamptz,
    note varchar(300),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS tuition_contracts_student_idx
    ON tuition_contracts(student_user_id, status);
--> statement-breakpoint
-- A discount is its own approved document, applied once, never a silent price mutation.
CREATE TABLE IF NOT EXISTS tuition_contract_discounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES tuition_contracts(id) ON DELETE CASCADE,
    period_key varchar(7) NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    reason varchar(200) NOT NULL,
    approved_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (contract_id, period_key)
);
CREATE INDEX IF NOT EXISTS tuition_contract_discounts_contract_idx
    ON tuition_contract_discounts(contract_id, period_key);
--> statement-breakpoint

-- ─────────────────────────── 4. Charges (receivables) ───────────────────────
CREATE TABLE IF NOT EXISTS tuition_charges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES tuition_contracts(id) ON DELETE SET NULL,
    student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    period_key varchar(7) NOT NULL,
    currency_code varchar(3) NOT NULL DEFAULT 'UZS',
    gross_amount_minor bigint NOT NULL,
    discount_amount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_amount_minor >= 0),
    net_amount_minor bigint NOT NULL,
    status varchar(10) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','approved','posted','reversed','credited')),
    is_reversal boolean NOT NULL DEFAULT false,
    original_charge_id uuid REFERENCES tuition_charges(id) ON DELETE SET NULL,
    reversal_reason varchar(200),
    due_date date NOT NULL,
    posted_at timestamptz,
    posted_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- A normal charge is a positive obligation; a correction is a separate negative
    -- document. `reversed` is a terminal marker on the original, never an edit of amounts.
    CHECK (net_amount_minor = gross_amount_minor - discount_amount_minor),
    CHECK ((is_reversal AND net_amount_minor <= 0 AND gross_amount_minor <= 0
            AND original_charge_id IS NOT NULL)
        OR (NOT is_reversal AND net_amount_minor >= 0 AND gross_amount_minor >= 0
            AND original_charge_id IS NULL))
);
CREATE INDEX IF NOT EXISTS tuition_charges_student_period_idx
    ON tuition_charges(student_user_id, period_key);
CREATE INDEX IF NOT EXISTS tuition_charges_open_idx
    ON tuition_charges(student_user_id, due_date) WHERE status = 'posted';
--> statement-breakpoint

-- ─────────────────────────── 5. Payments and receipts ───────────────────────
CREATE TABLE IF NOT EXISTS tuition_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    currency_code varchar(3) NOT NULL DEFAULT 'UZS',
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    method varchar(12) NOT NULL DEFAULT 'cash'
        CHECK (method IN ('cash','bank','provider')),
    provider varchar(20),
    provider_transaction_id varchar(80),
    idempotency_key varchar(120),
    status varchar(18) NOT NULL DEFAULT 'initiated'
        CHECK (status IN ('initiated','pending_provider','confirmed','rejected','expired',
                          'cancelled','partially_refunded','refunded')),
    receipt_no varchar(24),
    receipt_purpose varchar(120),
    operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    payer_name varchar(160),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (method <> 'provider' OR provider IS NOT NULL)
);
-- Exactly-once business effect under at-least-once provider delivery.
CREATE UNIQUE INDEX IF NOT EXISTS tuition_payments_provider_txn_uidx
    ON tuition_payments(provider, provider_transaction_id)
    WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tuition_payments_idempotency_uidx
    ON tuition_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tuition_payments_receipt_uidx
    ON tuition_payments(receipt_no) WHERE receipt_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS tuition_payments_student_idx
    ON tuition_payments(student_user_id, occurred_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tuition_payment_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES tuition_payments(id) ON DELETE RESTRICT,
    charge_id uuid NOT NULL REFERENCES tuition_charges(id) ON DELETE RESTRICT,
    amount_minor bigint NOT NULL,
    is_reversal boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((is_reversal AND amount_minor < 0) OR (NOT is_reversal AND amount_minor > 0)),
    UNIQUE (payment_id, charge_id, is_reversal)
);
CREATE INDEX IF NOT EXISTS tuition_payment_allocations_charge_idx
    ON tuition_payment_allocations(charge_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS tuition_refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES tuition_payments(id) ON DELETE RESTRICT,
    student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    currency_code varchar(3) NOT NULL DEFAULT 'UZS',
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    method varchar(12) NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank','provider')),
    reason varchar(200) NOT NULL,
    authorized_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider_refund_id varchar(80),
    provider_refund_state varchar(20) NOT NULL DEFAULT 'internal',
    created_at timestamptz NOT NULL DEFAULT now()
);
-- A provider refund confirmation may only ever produce one internal refund.
CREATE UNIQUE INDEX IF NOT EXISTS tuition_refunds_provider_uidx
    ON tuition_refunds(provider_refund_id) WHERE provider_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tuition_refunds_payment_idx
    ON tuition_refunds(payment_id, created_at);
--> statement-breakpoint
-- Receipt numbering is a server-owned sequence, so two operators cannot issue the same
-- receipt number for the same period.
CREATE TABLE IF NOT EXISTS cash_receipt_sequences (
    period_key varchar(7) PRIMARY KEY,
    next_value bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Day close: expected vs counted cash, variance with a reason, then the day is locked.
CREATE TABLE IF NOT EXISTS cash_day_closes (
    business_date date PRIMARY KEY,
    expected_minor bigint NOT NULL CHECK (expected_minor >= 0),
    counted_minor bigint NOT NULL CHECK (counted_minor >= 0),
    variance_minor bigint NOT NULL,
    reason varchar(300),
    closed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    closed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- A closed accounting period accepts no new postings. Corrections inside a closed period
-- need the documented correction policy (a dated reversing document in the open period).
CREATE TABLE IF NOT EXISTS finance_closed_periods (
    period_key varchar(7) PRIMARY KEY,
    closed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    closed_at timestamptz NOT NULL DEFAULT now(),
    reason varchar(300)
);
--> statement-breakpoint

-- ─────────────────────────── 7. Access policy ───────────────────────────
-- Same posture as every other private Learners Area table: RLS on, no grants to the
-- Supabase API roles. All access goes through the FastAPI service layer.
DO $access$
DECLARE
    api_role name;
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'finance_accounts','finance_journal_entries','finance_journal_lines',
        'tuition_contracts','tuition_contract_discounts','tuition_charges',
        'tuition_payments','tuition_payment_allocations','tuition_refunds',
        'cash_receipt_sequences','cash_day_closes','finance_closed_periods']::text[] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', table_name);
        FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
                EXECUTE format('REVOKE ALL ON %I FROM %I', table_name, api_role);
            END IF;
        END LOOP;
    END LOOP;
END $access$;
