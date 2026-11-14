-- 1120: approved contract terms are immutable (FIN-11).
--
-- The application refuses to change an approved contract's price, but an application rule is
-- not a control: one direct UPDATE, one migration script or one admin console bypasses it. A
-- receivable must be traceable to the terms a family actually agreed, so the freeze lives in
-- the database.
--
-- Commercial terms are frozen from approval onwards. A DRAFT stays editable - that is the
-- point of a draft - and the columns that record the approval process itself (status,
-- approved_by, approved_at) are obviously not frozen.
--
-- Additive: creates a function and a trigger. No row is changed and no column is dropped.

CREATE OR REPLACE FUNCTION tuition_contracts_freeze_terms() RETURNS trigger AS $freeze$
DECLARE
    changed text;
BEGIN
    IF OLD.status = 'draft' THEN
        RETURN NEW;
    END IF;
    IF NEW.monthly_amount_minor IS DISTINCT FROM OLD.monthly_amount_minor THEN
        changed := 'monthly_amount_minor';
    ELSIF NEW.term_months IS DISTINCT FROM OLD.term_months THEN
        changed := 'term_months';
    ELSIF NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
        changed := 'currency_code';
    ELSIF NEW.starts_on IS DISTINCT FROM OLD.starts_on THEN
        changed := 'starts_on';
    END IF;
    IF changed IS NOT NULL THEN
        RAISE EXCEPTION
            'contract terms are frozen after approval (% on contract %); use a credit note or a new contract',
            changed, OLD.id
            USING ERRCODE = '2F005';
    END IF;
    RETURN NEW;
END;
$freeze$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tuition_contracts_freeze_terms ON tuition_contracts;
CREATE TRIGGER tuition_contracts_freeze_terms
    BEFORE UPDATE ON tuition_contracts
    FOR EACH ROW EXECUTE FUNCTION tuition_contracts_freeze_terms();
