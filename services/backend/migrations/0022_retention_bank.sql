CREATE TYPE "public"."retention_attempt_status" AS ENUM('reading', 'recall', 'completed', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."retention_level" AS ENUM('A2', 'B1', 'B2', 'C1', 'C2');--> statement-breakpoint
CREATE TABLE "retention_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"retention_text_id" uuid NOT NULL,
	"retention_text_version_id" uuid NOT NULL,
	"level" "retention_level" NOT NULL,
	"rotation_cycle" integer DEFAULT 1 NOT NULL,
	"status" "retention_attempt_status" DEFAULT 'reading' NOT NULL,
	"read_started_at" timestamp with time zone NOT NULL,
	"read_ends_at" timestamp with time zone NOT NULL,
	"write_started_at" timestamp with time zone NOT NULL,
	"write_ends_at" timestamp with time zone NOT NULL,
	"recall_text" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"score" integer,
	"score_breakdown" jsonb,
	"evaluator_version" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_rotation_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"level" "retention_level" NOT NULL,
	"cycle_number" integer NOT NULL,
	"retention_text_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_rotation_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"level" "retention_level" NOT NULL,
	"cycle_number" integer DEFAULT 1 NOT NULL,
	"last_completed_text_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_text_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retention_text_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"body_text" text NOT NULL,
	"word_count" integer NOT NULL,
	"scoring_structure" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" "retention_level" NOT NULL,
	"internal_label" varchar(20) NOT NULL,
	"sequence" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"current_version_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retention_attempts" ADD CONSTRAINT "retention_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_attempts" ADD CONSTRAINT "retention_attempts_retention_text_id_retention_texts_id_fk" FOREIGN KEY ("retention_text_id") REFERENCES "public"."retention_texts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_attempts" ADD CONSTRAINT "retention_attempts_retention_text_version_id_retention_text_versions_id_fk" FOREIGN KEY ("retention_text_version_id") REFERENCES "public"."retention_text_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_rotation_completions" ADD CONSTRAINT "retention_rotation_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_rotation_completions" ADD CONSTRAINT "retention_rotation_completions_retention_text_id_retention_texts_id_fk" FOREIGN KEY ("retention_text_id") REFERENCES "public"."retention_texts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_rotation_state" ADD CONSTRAINT "retention_rotation_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_rotation_state" ADD CONSTRAINT "retention_rotation_state_last_completed_text_id_retention_texts_id_fk" FOREIGN KEY ("last_completed_text_id") REFERENCES "public"."retention_texts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_text_versions" ADD CONSTRAINT "retention_text_versions_retention_text_id_retention_texts_id_fk" FOREIGN KEY ("retention_text_id") REFERENCES "public"."retention_texts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_text_versions" ADD CONSTRAINT "retention_text_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_texts" ADD CONSTRAINT "retention_texts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retention_attempts_user_history_idx" ON "retention_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "retention_attempts_user_level_idx" ON "retention_attempts" USING btree ("user_id","level","status");--> statement-breakpoint
CREATE INDEX "retention_attempts_version_usage_idx" ON "retention_attempts" USING btree ("retention_text_version_id");--> statement-breakpoint
CREATE INDEX "retention_attempts_text_usage_idx" ON "retention_attempts" USING btree ("retention_text_id");--> statement-breakpoint
CREATE INDEX "retention_attempts_cycle_idx" ON "retention_attempts" USING btree ("user_id","level","rotation_cycle");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_rotation_completions_unique_idx" ON "retention_rotation_completions" USING btree ("user_id","level","cycle_number","retention_text_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_rotation_state_user_level_idx" ON "retention_rotation_state" USING btree ("user_id","level");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_text_versions_text_version_idx" ON "retention_text_versions" USING btree ("retention_text_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_text_versions_identity_idx" ON "retention_text_versions" USING btree ("id","retention_text_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_texts_label_idx" ON "retention_texts" USING btree ("internal_label");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_texts_level_sequence_idx" ON "retention_texts" USING btree ("level","sequence");--> statement-breakpoint
CREATE INDEX "retention_texts_level_active_idx" ON "retention_texts" USING btree ("level","active");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Invariants drizzle-kit cannot express, written by hand and verified against a
-- real PostgreSQL instance (scripts/verify-retention-schema.mjs).
-- ---------------------------------------------------------------------------
-- 1. A text's current version must BELONG to that text. The composite key
--    (id, retention_text_id) is unique, so this foreign key cannot be satisfied
--    by pointing text A at text B's version. ON DELETE RESTRICT: a version that
--    is current is never removed.
ALTER TABLE "retention_texts" ADD CONSTRAINT "retention_texts_current_version_identity_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."retention_text_versions"("id","retention_text_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- 2. At most ONE live attempt per learner per level. This is the multi-tab
--    invariant, enforced by the database rather than by a disabled button:
--    two simultaneous Start requests cannot both hold a text, because the
--    second insert violates this index. Terminal attempts (completed,
--    timed_out) are excluded, so history is unbounded.
CREATE UNIQUE INDEX "retention_attempts_one_active_idx" ON "retention_attempts" ("user_id","level") WHERE "status" IN ('reading','recall');--> statement-breakpoint
-- 3. Bounds that must hold whatever writes the row.
ALTER TABLE "retention_attempts" ADD CONSTRAINT "retention_attempts_score_range" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100));--> statement-breakpoint
ALTER TABLE "retention_attempts" ADD CONSTRAINT "retention_attempts_deadline_order" CHECK ("read_ends_at" >= "read_started_at" AND "write_ends_at" >= "read_ends_at");--> statement-breakpoint
ALTER TABLE "retention_attempts" ADD CONSTRAINT "retention_attempts_cycle_positive" CHECK ("rotation_cycle" >= 1);--> statement-breakpoint
ALTER TABLE "retention_text_versions" ADD CONSTRAINT "retention_text_versions_number_positive" CHECK ("version_number" >= 1);--> statement-breakpoint
ALTER TABLE "retention_text_versions" ADD CONSTRAINT "retention_text_versions_word_count_positive" CHECK ("word_count" >= 1);--> statement-breakpoint
ALTER TABLE "retention_texts" ADD CONSTRAINT "retention_texts_sequence_positive" CHECK ("sequence" >= 1);--> statement-breakpoint
ALTER TABLE "retention_rotation_state" ADD CONSTRAINT "retention_rotation_state_cycle_positive" CHECK ("cycle_number" >= 1);--> statement-breakpoint
ALTER TABLE "retention_rotation_completions" ADD CONSTRAINT "retention_rotation_completions_cycle_positive" CHECK ("cycle_number" >= 1);
