-- Versioned, explicitly approved prepaid contracts. No historical conversion/backfill.
CREATE TABLE tuition_service_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 contract_id uuid NOT NULL UNIQUE REFERENCES tuition_contracts(id) ON DELETE RESTRICT,
 student_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
 mode varchar(30) NOT NULL CHECK(mode IN ('PREPAID_CALENDAR_DAYS','PREPAID_LESSONS')),
 label varchar(120) NOT NULL CHECK(btrim(label)<>''),
 version varchar(30) NOT NULL DEFAULT 'service-policy-v1',
 price_amount_minor bigint NOT NULL CHECK(price_amount_minor BETWEEN 1 AND 90071992547409),
 price_units integer NOT NULL CHECK(price_units BETWEEN 1 AND 3660),
 max_units integer NOT NULL CHECK(max_units BETWEEN 1 AND 3660),
 eligible_weekdays smallint[] NOT NULL CHECK(cardinality(eligible_weekdays) BETWEEN 1 AND 7 AND eligible_weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
 excluded_dates date[] NOT NULL DEFAULT '{}',
 starts_on date NOT NULL,
 ends_on date,
 residual_rule varchar(30) NOT NULL CHECK(residual_rule='carry_money_without_expiry'),
 lesson_basis varchar(30) NOT NULL CHECK(lesson_basis='held_session_roster'),
 create_fingerprint varchar(64) NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on IS NULL OR ends_on>=starts_on),
 CHECK((approved_by IS NULL)=(approved_at IS NULL)),
 CHECK(approved_by IS NULL OR approved_by<>created_by),
 CHECK(price_amount_minor>=price_units),
 CHECK(ceil(price_amount_minor::numeric*max_units/price_units)<=90071992547409)
);
CREATE INDEX tuition_service_policies_student_idx ON tuition_service_policies(student_user_id,created_at,id);
CREATE INDEX tuition_service_policies_course_idx ON tuition_service_policies(course_id,starts_on);

ALTER TABLE tuition_contracts ADD COLUMN service_policy_id uuid UNIQUE REFERENCES tuition_service_policies(id) ON DELETE RESTRICT;
ALTER TABLE tuition_payments ADD COLUMN service_policy_id uuid REFERENCES tuition_service_policies(id) ON DELETE RESTRICT;
ALTER TABLE tuition_charges ADD COLUMN service_policy_id uuid REFERENCES tuition_service_policies(id) ON DELETE RESTRICT;
ALTER TABLE tuition_payment_intents ADD COLUMN service_policy_id uuid REFERENCES tuition_service_policies(id) ON DELETE RESTRICT;
CREATE INDEX tuition_payments_service_policy_idx ON tuition_payments(service_policy_id,id) WHERE service_policy_id IS NOT NULL;
CREATE INDEX tuition_charges_service_policy_idx ON tuition_charges(service_policy_id,id) WHERE service_policy_id IS NOT NULL;
CREATE INDEX tuition_intents_service_policy_idx ON tuition_payment_intents(service_policy_id) WHERE service_policy_id IS NOT NULL;
-- The old monthly uniqueness remains unchanged for every existing monthly contract.
DROP INDEX tuition_charges_one_live_installment_per_period;
CREATE UNIQUE INDEX tuition_charges_one_live_installment_per_period ON tuition_charges(contract_id,period_key)
 WHERE contract_id IS NOT NULL AND NOT is_reversal AND status NOT IN ('reversed','credited') AND service_policy_id IS NULL;

CREATE TABLE tuition_service_consumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 policy_id uuid NOT NULL REFERENCES tuition_service_policies(id) ON DELETE RESTRICT,
 service_ref varchar(80) NOT NULL,
 service_date date NOT NULL,
 session_id uuid REFERENCES academy_sessions(id) ON DELETE RESTRICT,
 charge_id uuid NOT NULL UNIQUE REFERENCES tuition_charges(id) ON DELETE RESTRICT,
 units integer NOT NULL CHECK(units=1),
 amount_minor bigint NOT NULL CHECK(amount_minor>0),
 actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(policy_id,service_ref)
);
CREATE INDEX tuition_service_consumptions_policy_date_idx ON tuition_service_consumptions(policy_id,service_date,id);
CREATE INDEX tuition_service_consumptions_session_idx ON tuition_service_consumptions(session_id) WHERE session_id IS NOT NULL;
CREATE TABLE tuition_service_events (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 policy_id uuid NOT NULL REFERENCES tuition_service_policies(id) ON DELETE RESTRICT,
 reason_type varchar(15) NOT NULL CHECK(reason_type IN ('payment','refund','service','pause')),
 source_id uuid NOT NULL,
 cash_balance_minor bigint NOT NULL CHECK(cash_balance_minor>=0),
 remaining_units integer NOT NULL CHECK(remaining_units>=0),
 units_delta integer NOT NULL,
 unapplied_credit_minor bigint NOT NULL CHECK(unapplied_credit_minor>=0),
 unit_price_minor bigint NOT NULL CHECK(unit_price_minor>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(policy_id,reason_type,source_id)
);
CREATE INDEX tuition_service_events_policy_idx ON tuition_service_events(policy_id,sequence DESC);
CREATE TABLE tuition_service_pauses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 policy_id uuid NOT NULL REFERENCES tuition_service_policies(id) ON DELETE RESTRICT,
 starts_on date NOT NULL,
 ends_on date NOT NULL CHECK(ends_on>=starts_on AND ends_on-starts_on<=3660),
 reason varchar(300) NOT NULL CHECK(btrim(reason)<>''),
 created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((approved_by IS NULL)=(approved_at IS NULL)),
 CHECK(approved_by IS NULL OR approved_by<>created_by)
);
CREATE INDEX tuition_service_pauses_policy_idx ON tuition_service_pauses(policy_id,starts_on,ends_on) WHERE approved_at IS NOT NULL;

CREATE FUNCTION tuition_service_policy_guard() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $body$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'service_policy_is_durable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tuition_contracts c WHERE c.id=NEW.contract_id
   AND c.student_user_id=NEW.student_user_id AND c.course_id=NEW.course_id AND c.monthly_amount_minor=0
   AND c.starts_on=NEW.starts_on AND c.ends_on IS NOT DISTINCT FROM NEW.ends_on) THEN
   RAISE EXCEPTION 'service_policy_contract_mismatch'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['approved_by','approved_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['approved_by','approved_at'])
    OR OLD.approved_at IS NOT NULL THEN RAISE EXCEPTION 'service_policy_terms_are_immutable'; END IF;
 END IF;
 IF NEW.approved_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users u
   WHERE u.id=NEW.approved_by AND u.role='owner' AND u.account_status='active') THEN
   RAISE EXCEPTION 'service_policy_approval_requires_owner'; END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER tuition_service_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON tuition_service_policies
 FOR EACH ROW EXECUTE FUNCTION tuition_service_policy_guard();
CREATE FUNCTION tuition_service_binding_guard() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $body$
BEGIN
 IF TG_OP='UPDATE' AND NEW.service_policy_id IS DISTINCT FROM OLD.service_policy_id
   AND NOT(TG_TABLE_NAME='tuition_contracts' AND OLD.status='draft'
       AND OLD.service_policy_id IS NULL AND NEW.service_policy_id IS NOT NULL) THEN
   RAISE EXCEPTION 'service_policy_binding_is_immutable'; END IF;
 IF TG_TABLE_NAME='tuition_payment_intents' THEN
  IF NEW.payment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tuition_payments p
    WHERE p.id=NEW.payment_id AND p.service_policy_id IS NOT DISTINCT FROM NEW.service_policy_id) THEN
    RAISE EXCEPTION 'service_payment_binding_mismatch'; END IF;
 END IF;
 IF NEW.service_policy_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tuition_service_policies p WHERE p.id=NEW.service_policy_id
   AND p.student_user_id=NEW.student_user_id
   AND (TG_TABLE_NAME<>'tuition_contracts' OR p.contract_id=NEW.id)) THEN
   RAISE EXCEPTION 'service_policy_beneficiary_mismatch'; END IF;
 IF TG_TABLE_NAME='tuition_payment_intents' THEN
  IF NEW.quote_version<>'svc1:'||NEW.service_policy_id::text THEN RAISE EXCEPTION 'service_policy_quote_mismatch'; END IF;
 END IF;
 IF TG_TABLE_NAME='tuition_charges' THEN
  IF NOT EXISTS(SELECT 1 FROM public.tuition_service_policies p WHERE p.id=NEW.service_policy_id
     AND p.contract_id=NEW.contract_id) THEN RAISE EXCEPTION 'service_charge_contract_mismatch'; END IF;
 END IF;
 IF TG_TABLE_NAME='tuition_contracts' THEN
  IF NOT EXISTS(SELECT 1 FROM public.tuition_service_policies p WHERE p.id=NEW.service_policy_id
    AND p.course_id=NEW.course_id AND p.starts_on=NEW.starts_on
    AND p.ends_on IS NOT DISTINCT FROM NEW.ends_on AND NEW.monthly_amount_minor=0) THEN
    RAISE EXCEPTION 'service_contract_terms_are_immutable'; END IF;
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER tuition_contracts_service_binding BEFORE INSERT OR UPDATE ON tuition_contracts FOR EACH ROW EXECUTE FUNCTION tuition_service_binding_guard();
CREATE TRIGGER tuition_payments_service_binding BEFORE INSERT OR UPDATE ON tuition_payments FOR EACH ROW EXECUTE FUNCTION tuition_service_binding_guard();
CREATE TRIGGER tuition_charges_service_binding BEFORE INSERT OR UPDATE ON tuition_charges FOR EACH ROW EXECUTE FUNCTION tuition_service_binding_guard();
CREATE TRIGGER tuition_intents_service_binding BEFORE INSERT OR UPDATE ON tuition_payment_intents FOR EACH ROW EXECUTE FUNCTION tuition_service_binding_guard();
CREATE TRIGGER tuition_service_consumptions_immutable BEFORE UPDATE OR DELETE ON tuition_service_consumptions FOR EACH ROW EXECUTE FUNCTION finance_journal_immutable_guard();
CREATE TRIGGER tuition_service_events_immutable BEFORE UPDATE OR DELETE ON tuition_service_events FOR EACH ROW EXECUTE FUNCTION finance_journal_immutable_guard();
CREATE FUNCTION tuition_service_pause_guard() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $body$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'service_pause_is_durable'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['approved_by','approved_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['approved_by','approved_at']) OR OLD.approved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'service_pause_is_immutable'; END IF;
 IF NEW.approved_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=NEW.approved_by
   AND u.role='owner' AND u.account_status='active') THEN RAISE EXCEPTION 'pause_approval_requires_owner'; END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER tuition_service_pause_guard BEFORE INSERT OR UPDATE OR DELETE ON tuition_service_pauses FOR EACH ROW EXECUTE FUNCTION tuition_service_pause_guard();
ALTER TABLE tuition_service_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuition_service_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuition_service_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuition_service_pauses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tuition_service_policies,tuition_service_consumptions,tuition_service_events,tuition_service_pauses FROM PUBLIC;
REVOKE ALL ON SEQUENCE tuition_service_events_sequence_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION tuition_service_policy_guard(),tuition_service_binding_guard(),tuition_service_pause_guard() FROM PUBLIC;
DO $roles$
DECLARE r name;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role']::name[] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON tuition_service_policies,tuition_service_consumptions,tuition_service_events,tuition_service_pauses FROM %I',r);
   EXECUTE format('REVOKE ALL ON SEQUENCE tuition_service_events_sequence_seq FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION tuition_service_policy_guard(),tuition_service_binding_guard(),tuition_service_pause_guard() FROM %I',r);
  END IF;
 END LOOP;
END $roles$;
