-- 1117: charge approval chain (FIN-06).
--
-- A receivable must pass through draft -> approved -> posted, and approval is an owner act
-- performed by someone other than the drafter. 1115 created `tuition_charges` without the
-- columns that make that chain auditable, so they are added here. Forward-only and additive:
-- no column is dropped, no row is rewritten, and an existing `posted` charge simply has a
-- NULL approver, which the read layer reports as "approved before this control existed"
-- rather than inventing one.

ALTER TABLE tuition_charges
    ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at timestamptz;
--> statement-breakpoint

-- Only one thing may occupy the "live obligation" slot per contract and period, and a draft
-- must not be able to sit next to an approved one forever: the 1116 partial unique index
-- already covers draft/approved/posted, so nothing further is needed here. This index makes
-- the approval queue a cheap scan instead of a full table read.
CREATE INDEX IF NOT EXISTS tuition_charges_pending_approval_idx
    ON tuition_charges(created_at) WHERE status = 'draft';
