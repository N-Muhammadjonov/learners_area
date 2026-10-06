-- Lesson architecture + typed native content blocks (Phase 2, §26, §27, §28, §84).
--
-- The course structure (courses → course_modules → units → lessons) already
-- existed; what a lesson could CONTAIN did not. This migration gives a lesson:
--
--   1. a publication lifecycle and stable identity, so an authored lesson is a
--      draft until someone publishes it, exactly like every other content type;
--   2. typed native blocks. A lesson is a sequence of typed blocks, never an
--      embedded mini application: `text` is plain text, `link` is an https URL,
--      `file`/`image`/`audio`/`video` are private storage keys, `quiz` is a
--      canonical question type + its answer model, and `content_reference` points
--      at canonical content (pinned or latest) instead of copying it.
--   3. learner answers to quiz blocks, graded through the shared question-type
--      registry, so a lesson quiz cannot invent its own grading rules.
--
-- Additive only. Existing lessons become published (the column default), so no
-- learner surface changes because of this migration. No column is dropped.

ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "publication_state" "publication_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "estimated_minutes" integer;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lessons_source_ref_idx" ON "lessons" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lessons_unit_order_idx" ON "lessons" USING btree ("unit_id","order");--> statement-breakpoint
CREATE TYPE "public"."lesson_block_type" AS ENUM('text', 'image', 'audio', 'video', 'file', 'link', 'quiz', 'content_reference');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lesson_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "lesson_block_type" NOT NULL,
	"text_content" text,
	"link_url" text,
	"object_key" text,
	"original_name" varchar(255),
	"mime_type" varchar(120),
	"size" integer,
	"ref_module" varchar(20),
	"ref_content_type" varchar(40),
	"ref_source_ref" varchar(80),
	"ref_content_version_id" uuid,
	"quiz_question_type" varchar(40),
	"quiz_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "lesson_blocks" ADD CONSTRAINT "lesson_blocks_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_blocks" ADD CONSTRAINT "lesson_blocks_ref_content_version_id_content_versions_id_fk" FOREIGN KEY ("ref_content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_blocks_position_idx" ON "lesson_blocks" USING btree ("lesson_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lesson_blocks_lesson_idx" ON "lesson_blocks" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lesson_blocks_reference_idx" ON "lesson_blocks" USING btree ("ref_module","ref_content_type","ref_source_ref");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lesson_block_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"answer" jsonb,
	"correct" boolean,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "lesson_block_responses" ADD CONSTRAINT "lesson_block_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_block_responses" ADD CONSTRAINT "lesson_block_responses_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_block_responses" ADD CONSTRAINT "lesson_block_responses_block_id_lesson_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."lesson_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_block_responses_user_block_idx" ON "lesson_block_responses" USING btree ("user_id","block_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lesson_block_responses_lesson_idx" ON "lesson_block_responses" USING btree ("lesson_id","user_id");
