-- Forward-only RIWI Assessment Contracts, Owner Policy & Security Signals Migration (ported from LEGACY_RIWI 0045, 0048)
--> statement-breakpoint
CREATE TYPE "public"."riwi_assessment_policy_state" AS ENUM('candidate', 'approved', 'superseded', 'rejected');--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "assessment_contract_key" varchar(80);--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "owner_policy_scope" varchar(100);--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "owner_policy_version" integer;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "teaching_feedback" jsonb;--> statement-breakpoint
ALTER TABLE "writing_grade_requests" ADD COLUMN IF NOT EXISTS "task_category" varchar(60);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "riwi_assessment_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" varchar(100) NOT NULL,
  "active_version" integer,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "riwi_assessment_policies_active_version_check" CHECK ("active_version" IS NULL OR "active_version" > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "riwi_assessment_policies_scope_uidx" ON "riwi_assessment_policies" USING btree ("scope");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "riwi_assessment_policies" ADD CONSTRAINT "riwi_assessment_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "riwi_assessment_policy_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "policy_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "state" "riwi_assessment_policy_state" DEFAULT 'candidate' NOT NULL,
  "overlay" jsonb NOT NULL,
  "source_message_hash" varchar(64) NOT NULL,
  "regression_fixture_id" varchar(120),
  "regression_evidence_hash" varchar(64),
  "regression_passed_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "reviewed_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "approved_at" timestamp with time zone,
  CONSTRAINT "riwi_assessment_policy_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "riwi_assessment_policy_versions_message_hash_check" CHECK ("source_message_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "riwi_assessment_policy_versions_regression_hash_check" CHECK ("regression_evidence_hash" IS NULL OR "regression_evidence_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "riwi_assessment_policy_versions_approval_check" CHECK ("state" <> 'approved' OR (
    "regression_fixture_id" IS NOT NULL AND "regression_evidence_hash" IS NOT NULL AND "regression_passed_at" IS NOT NULL AND
    "reviewed_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL
  ))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "riwi_assessment_policy_versions_policy_version_uidx" ON "riwi_assessment_policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "riwi_assessment_policy_versions_policy_hash_uidx" ON "riwi_assessment_policy_versions" USING btree ("policy_id","source_message_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "riwi_assessment_policy_versions_state_idx" ON "riwi_assessment_policy_versions" USING btree ("state","created_at","id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "riwi_assessment_policy_versions" ADD CONSTRAINT "riwi_assessment_policy_versions_policy_id_riwi_assessment_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."riwi_assessment_policies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "riwi_assessment_policy_versions" ADD CONSTRAINT "riwi_assessment_policy_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "riwi_assessment_policy_versions" ADD CONSTRAINT "riwi_assessment_policy_versions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TYPE "public"."riwi_security_signal_state" AS ENUM('candidate', 'in_review', 'approved_regression', 'rejected', 'developer_action_required');--> statement-breakpoint
CREATE TYPE "public"."riwi_security_signal_type" AS ENUM('prompt_injection', 'role_spoof', 'idor', 'tool_injection', 'provider_injection', 'ssrf', 'exfiltration', 'secret_extraction', 'exam_bypass', 'replay', 'toctou', 'knowledge_poisoning', 'assessment_policy_injection', 'prompt_version_downgrade');--> statement-breakpoint
CREATE TABLE "riwi_security_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_type" "riwi_security_signal_type" NOT NULL,
	"state" "riwi_security_signal_state" DEFAULT 'candidate' NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_role" "role",
	"route_class" varchar(120) NOT NULL,
	"sanitized_evidence" varchar(500) NOT NULL,
	"regression_fixture_id" varchar(120),
	"regression_evidence_hash" varchar(64),
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_security_signals_fingerprint_check" CHECK ("riwi_security_signals"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "riwi_security_signals_count_check" CHECK ("riwi_security_signals"."occurrence_count" > 0),
	CONSTRAINT "riwi_security_signals_regression_hash_check" CHECK ("riwi_security_signals"."regression_evidence_hash" is null or "riwi_security_signals"."regression_evidence_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "riwi_security_signals_promotion_check" CHECK ("riwi_security_signals"."state" <> 'approved_regression' or (
    "riwi_security_signals"."regression_fixture_id" is not null and "riwi_security_signals"."regression_evidence_hash" is not null and
    "riwi_security_signals"."reviewed_by_user_id" is not null and "riwi_security_signals"."reviewed_at" is not null
  ))
);
--> statement-breakpoint
ALTER TABLE "riwi_security_signals" ADD CONSTRAINT "riwi_security_signals_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_security_signals_fingerprint_uidx" ON "riwi_security_signals" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "riwi_security_signals_state_seen_idx" ON "riwi_security_signals" USING btree ("state","last_seen_at","id");--> statement-breakpoint
CREATE INDEX "riwi_security_signals_type_seen_idx" ON "riwi_security_signals" USING btree ("signal_type","last_seen_at");
