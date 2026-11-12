-- Durable, actor-bound, manually initiated guardian/staff message replies.
-- Original approved guardian_message_deliveries and batches remain unchanged.
CREATE TABLE IF NOT EXISTS guardian_message_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES guardian_message_deliveries(id) ON DELETE CASCADE,
  actor_telegram_id varchar(32) NOT NULL,
  source_message_id varchar(32) NOT NULL,
  sender_kind varchar(10) NOT NULL CHECK (sender_kind IN ('guardian', 'staff')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1500),
  status varchar(12) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'blocked')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  last_error varchar(120),
  telegram_message_id varchar(32),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_telegram_id, source_message_id)
);
CREATE INDEX IF NOT EXISTS guardian_replies_queue_idx
  ON guardian_message_replies(next_attempt_at) WHERE status IN ('queued','sending');
CREATE INDEX IF NOT EXISTS guardian_replies_delivery_idx
  ON guardian_message_replies(delivery_id, created_at);
ALTER TABLE guardian_message_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guardian_message_replies FROM PUBLIC;
DO $guard_replies$
DECLARE api_role name;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON guardian_message_replies FROM %I', api_role);
    END IF;
  END LOOP;
END $guard_replies$;
