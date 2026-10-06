-- Assignments over canonical content + grammar attempt binding (Phase 2, §24, §25,
-- §30, §71, §99).
--
-- An assignment used to be prose pointing at an optional writing prompt, with one
-- student per row. A task must now reference CANONICAL content — module, content
-- type, source ref and the EXACT revision assigned — so a learner's work stays
-- connected to what they were actually given, even after the content is edited.
--
-- Three changes, all additive:
--
--   1. `assignments` gains the canonical reference (module/content_type/source_ref
--      plus `content_version_id`). The old `related_writing_prompt_id` stays and is
--      kept in step for writing prompts, so existing screens keep working
--      (COMPATIBILITY ONLY — the canonical columns are what new code reads).
--   2. New `assignment_targets`: one row per student a task is set for, with its own
--      status. `assignments.target_user_id` remains the PRIMARY target of legacy
--      rows, so nothing that reads it breaks.
--   3. `grammar_attempts` gains `content_version_id`, so a grammar attempt records
--      the topic revision it was answered against (§71).

ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "module" varchar(20);--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "content_type" varchar(40);--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "instructions" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_content_idx" ON "assignments" USING btree ("module","content_type","source_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_version_idx" ON "assignments" USING btree ("content_version_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assignment_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'not_started' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "assignment_targets" ADD CONSTRAINT "assignment_targets_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_targets" ADD CONSTRAINT "assignment_targets_student_user_id_users_id_fk" FOREIGN KEY ("student_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assignment_targets_pair_idx" ON "assignment_targets" USING btree ("assignment_id","student_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignment_targets_student_idx" ON "assignment_targets" USING btree ("student_user_id","status");--> statement-breakpoint
ALTER TABLE "grammar_attempts" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;--> statement-breakpoint
ALTER TABLE "grammar_attempts" ADD CONSTRAINT "grammar_attempts_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;
