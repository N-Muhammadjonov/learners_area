-- 0074 Mock Hybrid Grading System (P1): weekly schedules, extended mock_attempts,
-- section submissions, writing answers, speaking audio, grading batches,
-- append-only grading revisions, import issues, and mock audit events.
--
-- Additive, idempotent, forward-safe migration. Does not alter or drop existing
-- learner history or content tables.

CREATE TABLE IF NOT EXISTS "mock_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mock_test_id" uuid NOT NULL REFERENCES "public"."mock_tests"("id") ON DELETE cascade ON UPDATE no action,
	"weekly_slot" varchar(32) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" varchar(40) DEFAULT 'Asia/Tashkent' NOT NULL,
	"policy_version" varchar(24) DEFAULT 'v1' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_schedules_window_chk" CHECK ("ends_at" > "starts_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_schedules_test_slot_uq" ON "mock_schedules" USING btree ("mock_test_id","weekly_slot");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_schedules_slot_window_idx" ON "mock_schedules" USING btree ("weekly_slot","starts_at","ends_at");--> statement-breakpoint

ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "schedule_id" uuid REFERENCES "public"."mock_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "weekly_slot" varchar(32);--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "content_snapshot_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "active_section_position" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "section_deadlines" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_attempts_user_weekly_slot_uq" ON "mock_attempts" USING btree ("user_id","weekly_slot") WHERE "weekly_slot" IS NOT NULL AND "status" <> 'abandoned';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_attempts_user_status_idx" ON "mock_attempts" USING btree ("user_id","status","started_at" DESC);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mock_section_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL REFERENCES "public"."mock_attempts"("id") ON DELETE cascade ON UPDATE no action,
	"skill" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'in_progress' NOT NULL,
	"raw_score" integer,
	"score_max" integer,
	"band" real,
	"answers_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_details" jsonb,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"answer_hash" varchar(64),
	"content_version_id" uuid REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_section_submissions_skill_chk" CHECK ("skill" IN ('listening','reading','writing','speaking')),
	CONSTRAINT "mock_section_submissions_band_chk" CHECK ("band" IS NULL OR ("band" >= 0 AND "band" <= 9))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_section_submissions_attempt_skill_uq" ON "mock_section_submissions" USING btree ("attempt_id","skill");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_section_submissions_skill_status_idx" ON "mock_section_submissions" USING btree ("skill","status","submitted_at" DESC);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mock_writing_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL REFERENCES "public"."mock_attempts"("id") ON DELETE cascade ON UPDATE no action,
	"task_type" varchar(16) NOT NULL,
	"prompt_snapshot_id" uuid REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action,
	"prompt_text" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"media_ref" text,
	"media_sha256" varchar(64),
	"word_count" integer DEFAULT 0 NOT NULL,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"finalized_at" timestamp with time zone,
	"sha256" varchar(64),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_writing_answers_task_type_chk" CHECK ("task_type" IN ('task1','task2')),
	CONSTRAINT "mock_writing_answers_word_count_chk" CHECK ("word_count" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_writing_answers_attempt_task_uq" ON "mock_writing_answers" USING btree ("attempt_id","task_type");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mock_speaking_audio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL REFERENCES "public"."mock_attempts"("id") ON DELETE cascade ON UPDATE no action,
	"part" varchar(8) NOT NULL,
	"question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"object_key" text NOT NULL,
	"upload_intent_id" uuid REFERENCES "public"."upload_intents"("id") ON DELETE set null ON UPDATE no action,
	"codec" varchar(64) NOT NULL,
	"mime_type" varchar(120) DEFAULT 'audio/webm' NOT NULL,
	"bytes" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"capture_status" varchar(32) DEFAULT 'finalized' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"finalized_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_speaking_audio_part_chk" CHECK ("part" IN ('P1','P2','P3')),
	CONSTRAINT "mock_speaking_audio_bytes_chk" CHECK ("bytes" > 0),
	CONSTRAINT "mock_speaking_audio_duration_chk" CHECK ("duration_ms" >= 0),
	CONSTRAINT "mock_speaking_audio_status_chk" CHECK ("capture_status" IN ('recording','finalized','incomplete','needs_review'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_speaking_audio_attempt_part_uq" ON "mock_speaking_audio" USING btree ("attempt_id","part");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mock_grading_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_code" varchar(64) NOT NULL,
	"scope" varchar(32) NOT NULL,
	"section" varchar(16) NOT NULL,
	"filter_mode" varchar(24) DEFAULT 'ungraded' NOT NULL,
	"date_from" date,
	"date_to" date,
	"created_by" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"export_manifest_hash" varchar(64) NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"student_alias_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'exported' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "mock_grading_batches_scope_chk" CHECK ("scope" IN ('assigned','owner')),
	CONSTRAINT "mock_grading_batches_section_chk" CHECK ("section" IN ('writing','speaking')),
	CONSTRAINT "mock_grading_batches_filter_chk" CHECK ("filter_mode" IN ('ungraded','all')),
	CONSTRAINT "mock_grading_batches_status_chk" CHECK ("status" IN ('awaiting_export','exported','imported_draft','needs_review','approved','published','retryable_failure'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_grading_batches_code_uq" ON "mock_grading_batches" USING btree ("batch_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_grading_batches_creator_idx" ON "mock_grading_batches" USING btree ("created_by","created_at" DESC);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mock_grading_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL REFERENCES "public"."mock_attempts"("id") ON DELETE cascade ON UPDATE no action,
	"section" varchar(16) NOT NULL,
	"batch_id" uuid NOT NULL REFERENCES "public"."mock_grading_batches"("id") ON DELETE cascade ON UPDATE no action,
	"rubric_version" varchar(32) NOT NULL,
	"source" varchar(32) DEFAULT 'gemini_manual' NOT NULL,
	"status" varchar(32) DEFAULT 'imported_draft' NOT NULL,
	"payload_json" jsonb NOT NULL,
	"raw_gemini_json" jsonb,
	"payload_sha256" varchar(64) NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"calculated_band" real,
	"task1_band" real,
	"task2_band" real,
	"author_user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action,
	"approved_by" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"approved_at" timestamp with time zone,
	"published_by" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"published_at" timestamp with time zone,
	"supersedes_id" uuid REFERENCES "public"."mock_grading_revisions"("id") ON DELETE set null ON UPDATE no action,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_grading_revisions_section_chk" CHECK ("section" IN ('writing','speaking')),
	CONSTRAINT "mock_grading_revisions_source_chk" CHECK ("source" IN ('gemini_manual','teacher_revision','owner_revision')),
	CONSTRAINT "mock_grading_revisions_status_chk" CHECK ("status" IN ('imported_draft','needs_review','approved','published','superseded')),
	CONSTRAINT "mock_grading_revisions_band_chk" CHECK ("calculated_band" IS NULL OR ("calculated_band" >= 0 AND "calculated_band" <= 9))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_grading_revisions_idempotent_import_uq" ON "mock_grading_revisions" USING btree ("batch_id","attempt_id","section","payload_sha256") WHERE "source" = 'gemini_manual';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_grading_revisions_attempt_section_idx" ON "mock_grading_revisions" USING btree ("attempt_id","section","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_grading_revisions_batch_status_idx" ON "mock_grading_revisions" USING btree ("batch_id","status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mock_grading_import_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL REFERENCES "public"."mock_grading_batches"("id") ON DELETE cascade ON UPDATE no action,
	"row_number" integer,
	"attempt_id" uuid REFERENCES "public"."mock_attempts"("id") ON DELETE set null ON UPDATE no action,
	"student_alias" varchar(32),
	"error_code" varchar(64) NOT NULL,
	"details" text NOT NULL,
	"created_by" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_grading_import_issues_batch_idx" ON "mock_grading_import_issues" USING btree ("batch_id","created_at" DESC);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mock_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	"attempt_id" uuid REFERENCES "public"."mock_attempts"("id") ON DELETE set null ON UPDATE no action,
	"batch_id" uuid REFERENCES "public"."mock_grading_batches"("id") ON DELETE set null ON UPDATE no action,
	"action" varchar(80) NOT NULL,
	"source_hash" varchar(64),
	"old_revision_id" uuid REFERENCES "public"."mock_grading_revisions"("id") ON DELETE set null ON UPDATE no action,
	"new_revision_id" uuid REFERENCES "public"."mock_grading_revisions"("id") ON DELETE set null ON UPDATE no action,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_audit_events_attempt_idx" ON "mock_audit_events" USING btree ("attempt_id","at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_audit_events_batch_idx" ON "mock_audit_events" USING btree ("batch_id","at" DESC);
