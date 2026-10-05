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