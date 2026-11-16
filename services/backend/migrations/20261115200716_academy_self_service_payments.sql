-- Private self-service orders. Money remains in the existing append-only tuition ledger.
-- No seed data, historical updates, grants, or production activation.
CREATE TABLE tuition_payment_intents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prepare_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    payer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    guardian_link_id uuid REFERENCES guardian_links(id) ON DELETE RESTRICT,
    amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 90071992547409),
    currency_code varchar(3) NOT NULL DEFAULT 'UZS' CHECK (currency_code='UZS'),
    provider varchar(8) NOT NULL CHECK (provider IN ('click','payme','uzum')),
    provider_environment varchar(8) NOT NULL DEFAULT 'live' CHECK (provider_environment IN ('sandbox','live')),
    idempotency_key uuid NOT NULL,
    quote_version varchar(50) NOT NULL DEFAULT 'monthly-invoice-v1',
    status varchar(16) NOT NULL DEFAULT 'created'
        CHECK (status IN ('created','pending','paid','failed','cancelled','expired')),
    payment_id uuid UNIQUE REFERENCES tuition_payments(id) ON DELETE RESTRICT,
    provider_transaction_id varchar(200),
    provider_created_ms bigint,
    performed_ms bigint,
    cancelled_ms bigint,
    cancellation_reason integer,
    checkout_url text,
    checkout_state varchar(16) NOT NULL DEFAULT 'new'
        CHECK (checkout_state IN ('new','registering','ready','unknown')),
    verification_attempts integer NOT NULL DEFAULT 0 CHECK (verification_attempts BETWEEN 0 AND 12),
    next_check_at timestamptz NOT NULL DEFAULT now(),
    verification_error_code varchar(50),
    fiscal_status varchar(24) NOT NULL DEFAULT 'manual_review'
        CHECK (fiscal_status IN ('not_required','pending','issued','failed','manual_review')),
    fiscal_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 minutes'),
    UNIQUE(payer_user_id,idempotency_key),
    UNIQUE(provider,provider_transaction_id),
    CHECK (status <> 'paid' OR payment_id IS NOT NULL),
    CHECK (fiscal_url IS NULL OR fiscal_status='issued'),
    CHECK (expires_at > created_at)
);
CREATE INDEX tuition_payment_intents_student_history_idx
    ON tuition_payment_intents(student_user_id,created_at DESC,id DESC);
CREATE INDEX tuition_payment_intents_provider_pending_idx
    ON tuition_payment_intents(provider,next_check_at) WHERE status IN ('created','pending');
CREATE INDEX tuition_payment_intents_payer_idx ON tuition_payment_intents(payer_user_id,created_at DESC);
CREATE INDEX tuition_payment_intents_guardian_link_idx ON tuition_payment_intents(guardian_link_id)
    WHERE guardian_link_id IS NOT NULL;

CREATE TABLE tuition_provider_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id uuid NOT NULL REFERENCES tuition_payment_intents(id) ON DELETE RESTRICT,
    provider varchar(8) NOT NULL CHECK (provider IN ('click','payme','uzum')),
    event_key varchar(200) NOT NULL,
    fingerprint varchar(64) NOT NULL,
    event_type varchar(40) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider,event_key)
);
CREATE INDEX tuition_provider_events_intent_idx ON tuition_provider_events(intent_id,created_at);

CREATE FUNCTION tuition_intent_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $guard$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment_intent_is_durable'; END IF;
    IF NEW.payment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.tuition_payments p WHERE p.id=NEW.payment_id
        AND p.student_user_id=NEW.student_user_id AND p.amount_minor=NEW.amount_minor
        AND p.currency_code=NEW.currency_code AND p.provider=NEW.provider
        AND p.provider_transaction_id=NEW.provider_transaction_id
        AND p.idempotency_key=NEW.id::text
        AND (NEW.status<>'paid' OR p.status IN ('confirmed','partially_refunded','refunded'))
    ) THEN RAISE EXCEPTION 'intent_payment_binding_mismatch'; END IF;
    IF NEW.guardian_link_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.guardian_links l JOIN public.guardian_profiles g ON g.id=l.guardian_profile_id
        WHERE l.id=NEW.guardian_link_id AND l.student_id=NEW.student_user_id AND g.user_id=NEW.payer_user_id
    ) THEN RAISE EXCEPTION 'intent_guardian_binding_mismatch'; END IF;
    IF TG_OP='INSERT' THEN RETURN NEW; END IF;
    IF ROW(NEW.id,NEW.prepare_number,NEW.student_user_id,NEW.payer_user_id,NEW.guardian_link_id,
           NEW.amount_minor,NEW.currency_code,NEW.provider,NEW.provider_environment,NEW.idempotency_key,NEW.quote_version,
           NEW.created_at,NEW.expires_at)
       IS DISTINCT FROM
       ROW(OLD.id,OLD.prepare_number,OLD.student_user_id,OLD.payer_user_id,OLD.guardian_link_id,
           OLD.amount_minor,OLD.currency_code,OLD.provider,OLD.provider_environment,OLD.idempotency_key,OLD.quote_version,
           OLD.created_at,OLD.expires_at) THEN RAISE EXCEPTION 'payment_quote_is_immutable'; END IF;
    IF OLD.provider_transaction_id IS NOT NULL AND
       NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id THEN
        RAISE EXCEPTION 'provider_reference_is_immutable'; END IF;
    IF OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
        RAISE EXCEPTION 'payment_reference_is_immutable'; END IF;
    IF OLD.status IN ('paid','failed','cancelled','expired') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'payment_intent_is_terminal'; END IF;
    RETURN NEW;
END $guard$;
CREATE TRIGGER tuition_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON tuition_payment_intents
    FOR EACH ROW EXECUTE FUNCTION tuition_intent_guard();
CREATE TRIGGER tuition_provider_events_immutable BEFORE UPDATE OR DELETE ON tuition_provider_events
    FOR EACH ROW EXECUTE FUNCTION finance_journal_immutable_guard();
REVOKE ALL ON FUNCTION tuition_intent_guard() FROM PUBLIC;

ALTER TABLE tuition_payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuition_provider_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tuition_payment_intents,tuition_provider_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE tuition_payment_intents_prepare_number_seq FROM PUBLIC;
DO $access$
DECLARE api_role name;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
            EXECUTE format('REVOKE ALL ON tuition_payment_intents,tuition_provider_events FROM %I',api_role);
            EXECUTE format('REVOKE ALL ON SEQUENCE tuition_payment_intents_prepare_number_seq FROM %I',api_role);
            EXECUTE format('REVOKE ALL ON FUNCTION tuition_intent_guard() FROM %I',api_role);
        END IF;
    END LOOP;
END $access$;
