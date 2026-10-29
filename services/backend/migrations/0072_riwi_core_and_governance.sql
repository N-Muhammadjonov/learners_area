-- Forward-only RIWI Core & Governance Migration (ported from LEGACY_RIWI 0036..0044)
--> statement-breakpoint
CREATE TYPE "public"."riwi_conflict_state" AS ENUM('open', 'resolved', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."riwi_conversation_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."riwi_experiment_state" AS ENUM('pending', 'running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."riwi_knowledge_scope" AS ENUM('global', 'role', 'user');--> statement-breakpoint
CREATE TYPE "public"."riwi_knowledge_source_type" AS ENUM('owner_instruction', 'ielts_rubric', 'grammar_material', 'vocabulary_material', 'speaking_material', 'writing_material', 'dictionary_material', 'learning_methodology', 'course_document', 'policy', 'verified_example', 'provider_evaluation', 'teacher_correction', 'owner_correction', 'regression_fixture');--> statement-breakpoint
CREATE TYPE "public"."riwi_knowledge_state" AS ENUM('draft', 'parsed', 'analyzed', 'candidate', 'approved', 'active', 'superseded', 'rejected', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."riwi_learning_signal_state" AS ENUM('candidate', 'in_review', 'accepted', 'rejected', 'promoted');--> statement-breakpoint
CREATE TYPE "public"."riwi_learning_signal_type" AS ENUM('owner_correction', 'teacher_correction', 'provider_disagreement', 'provider_agreement', 'student_outcome', 'rubric_reference', 'known_good_example', 'known_bad_example', 'retrieval_failure', 'hallucination_report', 'tool_failure', 'user_feedback', 'manual_qa_finding');--> statement-breakpoint
CREATE TYPE "public"."riwi_review_decision" AS ENUM('approve', 'reject', 'request_changes');--> statement-breakpoint
CREATE TABLE "riwi_action_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"tool_name" varchar(80) NOT NULL,
	"target_id" varchar(80),
	"input_hash" varchar(64) NOT NULL,
	"idempotency_key" varchar(80) NOT NULL,
	"preview" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riwi_conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "riwi_conversation_message_role" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_conversation_messages_content_check" CHECK (length("riwi_conversation_messages"."content") between 1 and 6000)
);
--> statement-breakpoint
CREATE TABLE "riwi_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_at_creation" "role" NOT NULL,
	"locale" varchar(5) DEFAULT 'uz' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riwi_knowledge_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_source_id" uuid NOT NULL,
	"candidate_unit_id" uuid NOT NULL,
	"active_source_id" uuid NOT NULL,
	"active_unit_id" uuid NOT NULL,
	"conflict_key" varchar(64) NOT NULL,
	"reason" varchar(60) NOT NULL,
	"state" "riwi_conflict_state" DEFAULT 'open' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolution_note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "riwi_knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "riwi_knowledge_source_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"provenance" varchar(500) NOT NULL,
	"rights_class" varchar(40) NOT NULL,
	"authority" smallint DEFAULT 30 NOT NULL,
	"scope" "riwi_knowledge_scope" DEFAULT 'global' NOT NULL,
	"scope_role" "role",
	"scope_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"state" "riwi_knowledge_state" DEFAULT 'draft' NOT NULL,
	"source_object_key" text,
	"parser_version" varchar(40),
	"unit_count" integer DEFAULT 0 NOT NULL,
	"supersedes_source_id" uuid,
	"created_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_knowledge_sources_authority_check" CHECK ("riwi_knowledge_sources"."authority" between 0 and 100),
	CONSTRAINT "riwi_knowledge_sources_version_check" CHECK ("riwi_knowledge_sources"."version" > 0),
	CONSTRAINT "riwi_knowledge_sources_unit_count_check" CHECK ("riwi_knowledge_sources"."unit_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "riwi_knowledge_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" varchar(240),
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"character_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_knowledge_units_ordinal_check" CHECK ("riwi_knowledge_units"."ordinal" >= 0),
	CONSTRAINT "riwi_knowledge_units_character_count_check" CHECK ("riwi_knowledge_units"."character_count" between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "riwi_learning_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"decision" "riwi_review_decision" NOT NULL,
	"reason" varchar(1000) NOT NULL,
	"regression_fixture_id" varchar(120),
	"resulting_source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_learning_reviews_approve_regression_check" CHECK ("riwi_learning_reviews"."decision" <> 'approve' or "riwi_learning_reviews"."regression_fixture_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "riwi_learning_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_type" "riwi_learning_signal_type" NOT NULL,
	"state" "riwi_learning_signal_state" DEFAULT 'candidate' NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "role" NOT NULL,
	"target_user_id" uuid,
	"source_id" uuid,
	"provider_id" varchar(60),
	"model" varchar(120),
	"prompt_version" varchar(60),
	"rubric_version" varchar(60),
	"candidate_claim" varchar(4000) NOT NULL,
	"evidence_summary" varchar(1200) NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"scope" "riwi_knowledge_scope" DEFAULT 'global' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riwi_provider_experiment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"provider_id" varchar(60) NOT NULL,
	"model" varchar(120),
	"state" varchar(24) NOT NULL,
	"normalized_result" jsonb,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_micros" integer,
	"safe_error_code" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_provider_experiment_results_duration_check" CHECK ("riwi_provider_experiment_results"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "riwi_provider_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"task_profile" varchar(60) NOT NULL,
	"fixture_id" varchar(120) NOT NULL,
	"providers" jsonb NOT NULL,
	"state" "riwi_experiment_state" DEFAULT 'pending' NOT NULL,
	"budget_micros" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "riwi_provider_experiments_budget_check" CHECK ("riwi_provider_experiments"."budget_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "riwi_usage_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "role" NOT NULL,
	"task_profile" varchar(60) NOT NULL,
	"provider_id" varchar(60),
	"model" varchar(120),
	"state" varchar(24) NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_micros" integer,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "riwi_usage_metrics_duration_check" CHECK ("riwi_usage_metrics"."duration_ms" >= 0),
	CONSTRAINT "riwi_usage_metrics_tokens_check" CHECK (("riwi_usage_metrics"."input_tokens" is null or "riwi_usage_metrics"."input_tokens" >= 0) and ("riwi_usage_metrics"."output_tokens" is null or "riwi_usage_metrics"."output_tokens" >= 0))
);
--> statement-breakpoint
ALTER TABLE "riwi_action_confirmations" ADD CONSTRAINT "riwi_action_confirmations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_conversation_messages" ADD CONSTRAINT "riwi_conversation_messages_conversation_id_riwi_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."riwi_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_conversations" ADD CONSTRAINT "riwi_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_candidate_source_id_riwi_knowledge_sources_id_fk" FOREIGN KEY ("candidate_source_id") REFERENCES "public"."riwi_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_candidate_unit_id_riwi_knowledge_units_id_fk" FOREIGN KEY ("candidate_unit_id") REFERENCES "public"."riwi_knowledge_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_active_source_id_riwi_knowledge_sources_id_fk" FOREIGN KEY ("active_source_id") REFERENCES "public"."riwi_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_active_unit_id_riwi_knowledge_units_id_fk" FOREIGN KEY ("active_unit_id") REFERENCES "public"."riwi_knowledge_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_knowledge_conflicts" ADD CONSTRAINT "riwi_knowledge_conflicts_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_scope_user_id_users_id_fk" FOREIGN KEY ("scope_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_knowledge_units" ADD CONSTRAINT "riwi_knowledge_units_source_id_riwi_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."riwi_knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" ADD CONSTRAINT "riwi_learning_reviews_signal_id_riwi_learning_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."riwi_learning_signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" ADD CONSTRAINT "riwi_learning_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_provider_experiment_results" ADD CONSTRAINT "riwi_provider_experiment_results_experiment_id_riwi_provider_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."riwi_provider_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_provider_experiments" ADD CONSTRAINT "riwi_provider_experiments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riwi_usage_metrics" ADD CONSTRAINT "riwi_usage_metrics_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_action_confirmations_idempotency_uidx" ON "riwi_action_confirmations" USING btree ("actor_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "riwi_action_confirmations_expiry_idx" ON "riwi_action_confirmations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "riwi_conversation_messages_order_idx" ON "riwi_conversation_messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "riwi_conversations_owner_updated_idx" ON "riwi_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "riwi_conversations_expiry_idx" ON "riwi_conversations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "riwi_knowledge_conflicts_candidate_state_idx" ON "riwi_knowledge_conflicts" USING btree ("candidate_source_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_knowledge_conflicts_pair_uidx" ON "riwi_knowledge_conflicts" USING btree ("candidate_unit_id","active_unit_id");--> statement-breakpoint
CREATE INDEX "riwi_knowledge_sources_state_idx" ON "riwi_knowledge_sources" USING btree ("state","authority","updated_at");--> statement-breakpoint
CREATE INDEX "riwi_knowledge_sources_scope_idx" ON "riwi_knowledge_sources" USING btree ("scope","scope_role","scope_user_id","state");--> statement-breakpoint
CREATE INDEX "riwi_knowledge_sources_checksum_idx" ON "riwi_knowledge_sources" USING btree ("checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_knowledge_units_source_ordinal_uidx" ON "riwi_knowledge_units" USING btree ("source_id","ordinal");--> statement-breakpoint
CREATE INDEX "riwi_knowledge_units_content_hash_idx" ON "riwi_knowledge_units" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "riwi_knowledge_units_content_fts_idx" ON "riwi_knowledge_units" USING gin (to_tsvector('simple', "content"));--> statement-breakpoint
CREATE INDEX "riwi_learning_reviews_signal_idx" ON "riwi_learning_reviews" USING btree ("signal_id","created_at");--> statement-breakpoint
CREATE INDEX "riwi_learning_signals_state_created_idx" ON "riwi_learning_signals" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "riwi_learning_signals_actor_idx" ON "riwi_learning_signals" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "riwi_learning_signals_target_idx" ON "riwi_learning_signals" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_provider_experiment_results_pair_uidx" ON "riwi_provider_experiment_results" USING btree ("experiment_id","provider_id");--> statement-breakpoint
CREATE INDEX "riwi_provider_experiments_actor_created_idx" ON "riwi_provider_experiments" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "riwi_usage_metrics_role_created_idx" ON "riwi_usage_metrics" USING btree ("actor_role","created_at");--> statement-breakpoint
CREATE INDEX "riwi_usage_metrics_actor_created_idx" ON "riwi_usage_metrics" USING btree ("actor_user_id","created_at");
--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" DROP CONSTRAINT "riwi_learning_reviews_approve_regression_check";--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "regression_fixture_id" varchar(120);--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "regression_evidence_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "regression_passed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" ADD COLUMN "regression_evidence_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" ADD COLUMN "regression_passed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_knowledge_sources_type_checksum_uidx" ON "riwi_knowledge_sources" USING btree ("source_type","checksum");--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_scope_consistency_check" CHECK ((
    ("riwi_knowledge_sources"."scope" = 'global' and "riwi_knowledge_sources"."scope_role" is null and "riwi_knowledge_sources"."scope_user_id" is null) or
    ("riwi_knowledge_sources"."scope" = 'role' and "riwi_knowledge_sources"."scope_role" is not null and "riwi_knowledge_sources"."scope_user_id" is null) or
    ("riwi_knowledge_sources"."scope" = 'user' and "riwi_knowledge_sources"."scope_role" is null and "riwi_knowledge_sources"."scope_user_id" is not null)
  ));--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_active_regression_check" CHECK ("riwi_knowledge_sources"."state" <> 'active' or (
    "riwi_knowledge_sources"."regression_fixture_id" is not null and "riwi_knowledge_sources"."regression_evidence_hash" is not null and "riwi_knowledge_sources"."regression_passed_at" is not null
  ));--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" ADD CONSTRAINT "riwi_learning_reviews_approve_regression_check" CHECK ("riwi_learning_reviews"."decision" <> 'approve' or (
    "riwi_learning_reviews"."regression_fixture_id" is not null and "riwi_learning_reviews"."regression_evidence_hash" is not null and "riwi_learning_reviews"."regression_passed_at" is not null
  ));--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_scope_target_check" CHECK ((
    ("riwi_learning_signals"."scope" = 'global' and "riwi_learning_signals"."target_user_id" is null) or
    ("riwi_learning_signals"."scope" = 'user' and "riwi_learning_signals"."target_user_id" is not null)
  ));--> statement-breakpoint
ALTER TABLE "riwi_usage_metrics" ADD CONSTRAINT "riwi_usage_metrics_cost_check" CHECK ("riwi_usage_metrics"."estimated_cost_micros" is null or "riwi_usage_metrics"."estimated_cost_micros" >= 0);
--> statement-breakpoint
ALTER TABLE "riwi_provider_experiments" ADD COLUMN "idempotency_key" varchar(80);--> statement-breakpoint
UPDATE "riwi_provider_experiments" SET "idempotency_key" = 'legacy-' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "riwi_provider_experiments" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_provider_experiments_actor_idempotency_uidx" ON "riwi_provider_experiments" USING btree ("actor_user_id","idempotency_key");
--> statement-breakpoint
ALTER TYPE "public"."riwi_learning_signal_type" ADD VALUE 'provider_failure' BEFORE 'user_feedback';--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_learning_signals_actor_source_uidx" ON "riwi_learning_signals" USING btree ("actor_user_id","signal_type","source_id") WHERE "riwi_learning_signals"."actor_user_id" is not null and "riwi_learning_signals"."source_id" is not null;
--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" DROP CONSTRAINT "riwi_learning_signals_scope_target_check";--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ALTER COLUMN "source_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
UPDATE "riwi_learning_signals" SET "source_id" = gen_random_uuid() WHERE "source_id" IS NULL;--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_scope_target_check" CHECK ((
    ("riwi_learning_signals"."scope" = 'global' and "riwi_learning_signals"."target_user_id" is null) or
    "riwi_learning_signals"."scope" = 'user'
  ));
--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" ADD CONSTRAINT "riwi_learning_reviews_resulting_source_id_riwi_knowledge_sources_id_fk" FOREIGN KEY ("resulting_source_id") REFERENCES "public"."riwi_knowledge_sources"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TYPE "public"."upload_purpose" ADD VALUE 'riwi_knowledge_source';--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "source_checksum" varchar(64);--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_source_checksum_check" CHECK ("riwi_knowledge_sources"."source_checksum" is null or "riwi_knowledge_sources"."source_checksum" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE INDEX "users_riwi_active_student_target_idx" ON "users" USING btree (lower(trim("name")),"id") WHERE "users"."role" = 'student' AND "users"."account_status" = 'active';
--> statement-breakpoint
DROP INDEX "riwi_provider_experiments_actor_created_idx";--> statement-breakpoint
CREATE INDEX "audit_log_created_id_idx" ON "audit_log" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "riwi_knowledge_sources_history_idx" ON "riwi_knowledge_sources" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "riwi_learning_signals_history_idx" ON "riwi_learning_signals" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "riwi_provider_experiments_actor_created_idx" ON "riwi_provider_experiments" USING btree ("actor_user_id","created_at","id");
