-- Durable leases and an idempotent, isolated sandbox delivery sink.
ALTER TABLE finance_outbox_events
    ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS lease_token uuid,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS finance_outbox_dispatch_idx
    ON finance_outbox_events (topic, next_attempt_at, created_at, id)
    WHERE published_at IS NULL AND dead_lettered_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS finance_outbox_sandbox_receipts (
    event_id uuid PRIMARY KEY REFERENCES finance_outbox_events(id),
    delivered_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE finance_outbox_sandbox_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance_outbox_sandbox_receipts FROM PUBLIC;
--> statement-breakpoint
DO $access1121$
DECLARE
    api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON finance_outbox_sandbox_receipts FROM %I', api_role);
        END IF;
    END LOOP;
END $access1121$;
