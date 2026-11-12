-- Parent Connect (forward-only, additive). Reuses users, telegram_contacts (verified native phone) and the
-- existing bot. No destructive statements. Every table is server-only (RLS on, API roles revoked), like the
-- other Telegram/coin tables.

CREATE TABLE IF NOT EXISTS guardian_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id    varchar(32) NOT NULL UNIQUE,
  user_id             uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  display_name        varchar(200),
  language            varchar(2) CHECK (language IN ('uz','en')),
  channel_verified_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guardian_invitations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash             char(64) NOT NULL UNIQUE,      -- sha256 of the opaque token; the token itself is never stored
  intended_relationship  varchar(24),
  created_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  consumed_at            timestamptz,
  consumed_by_telegram_id varchar(32),
  cancelled_at           timestamptz
);
CREATE INDEX IF NOT EXISTS guardian_invitations_student_idx ON guardian_invitations(student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS guardian_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_profile_id uuid NOT NULL REFERENCES guardian_profiles(id) ON DELETE CASCADE,
  student_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitation_id       uuid REFERENCES guardian_invitations(id) ON DELETE SET NULL,
  relationship        varchar(24) CHECK (relationship IN
    ('mother','father','older_brother','younger_brother','older_sister','younger_sister','guardian','other')),
  status              varchar(24) NOT NULL CHECK (status IN
    ('awaiting_guardian','awaiting_student','linked','revoked','rejected')),
  requested_at        timestamptz NOT NULL DEFAULT now(),
  guardian_ready_at   timestamptz,
  approved_at         timestamptz,
  revoked_at          timestamptz,
  revoked_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- One live link per guardian/student pair; one student may have many guardians, one guardian many children.
CREATE UNIQUE INDEX IF NOT EXISTS guardian_links_live_pair
  ON guardian_links(guardian_profile_id, student_id)
  WHERE status IN ('awaiting_guardian','awaiting_student','linked');
CREATE INDEX IF NOT EXISTS guardian_links_student_idx ON guardian_links(student_id, status);
CREATE INDEX IF NOT EXISTS guardian_links_guardian_idx ON guardian_links(guardian_profile_id, status);

CREATE TABLE IF NOT EXISTS guardian_message_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id   uuid NOT NULL REFERENCES users(id),
  idempotency_key  varchar(80) NOT NULL,
  template_key     varchar(40),
  body_template    text NOT NULL,
  recipient_count  integer NOT NULL CHECK (recipient_count > 0),
  approved_at      timestamptz NOT NULL DEFAULT now(),   -- the explicit human confirmation instant
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sender_user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS guardian_message_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            uuid NOT NULL REFERENCES guardian_message_batches(id) ON DELETE CASCADE,
  link_id             uuid REFERENCES guardian_links(id) ON DELETE SET NULL,
  guardian_profile_id uuid NOT NULL REFERENCES guardian_profiles(id) ON DELETE CASCADE,
  student_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id    varchar(32) NOT NULL,
  rendered_text       text NOT NULL,
  status              varchar(12) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','blocked')),
  attempts            integer NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  claimed_at          timestamptz,
  last_error          varchar(120),
  telegram_message_id varchar(32),
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, guardian_profile_id, student_id)
);
CREATE INDEX IF NOT EXISTS guardian_deliveries_queue_idx
  ON guardian_message_deliveries(next_attempt_at) WHERE status IN ('queued','sending');

CREATE TABLE IF NOT EXISTS guardian_audit_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_telegram_id varchar(32),
  action            varchar(60) NOT NULL,
  link_id           uuid,
  student_id        uuid,
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guardian_audit_created_idx ON guardian_audit_events(created_at DESC);

ALTER TABLE guardian_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_message_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_message_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON guardian_profiles, guardian_invitations, guardian_links, guardian_message_batches,
    guardian_message_deliveries, guardian_audit_events FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON guardian_profiles, guardian_invitations, guardian_links, guardian_message_batches,
          guardian_message_deliveries, guardian_audit_events FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
