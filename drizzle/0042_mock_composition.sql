-- 0042 Mock composition: a mock is an ORCHESTRATION OBJECT, never copied content.
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027 (0028-0041 were hand-written too), so `drizzle-kit generate` would
-- re-emit the whole schema instead of a delta.
--
-- Before this migration `mock_tests` was a catalogue row (id, course_id, title,
-- skill) and `mock_attempts` held a score — there was no way to say WHICH
-- Listening test a mock contained, no way to pin the revision a learner was
-- graded against, and no place for the assessment policy that §15/§16 require to
-- live outside React.
--
--  1. mock_tests gains the assessment policy: track, kind, timing policy,
--     navigation policy, score-policy references, publication state, version.
--  2. mock_sections holds the MEMBERSHIP: which canonical content, at which
--     exact content version, in which order, with how long. Nothing is copied —
--     a section is a reference.
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "track" varchar(24) DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "kind" varchar(24) DEFAULT 'sectional' NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "timing_policy_id" varchar(40);--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "timing_policy_version" varchar(24);--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "navigation" jsonb;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "score_policies" jsonb;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "publication_state" "publication_state" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_tests" ADD CONSTRAINT "mock_tests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mock_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mock_test_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"skill" varchar(16) NOT NULL,
	"module" varchar(20) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"source_ref" varchar(80) NOT NULL,
	"content_version_id" uuid,
	"label" varchar(120),
	"question_count" integer,
	"seconds" integer,
	"optional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "mock_sections" ADD CONSTRAINT "mock_sections_mock_test_id_mock_tests_id_fk" FOREIGN KEY ("mock_test_id") REFERENCES "public"."mock_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_sections" ADD CONSTRAINT "mock_sections_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mock_sections_position_idx" ON "mock_sections" USING btree ("mock_test_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mock_sections_version_idx" ON "mock_sections" USING btree ("content_version_id");--> statement-breakpoint
-- A learner's mock attempt records the mock VERSION it started, so a later edit of
-- the composition cannot rewrite what that attempt was (§13).
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "mock_version" integer;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "section_results" jsonb;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "status" varchar(24) DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "content_version_bindings" jsonb;
--> statement-breakpoint
-- Learner history must outlive the thing it was taken against (§94, §103).
-- Deleting a mock removes its composition, never the learner's record of it.
ALTER TABLE "mock_attempts" ALTER COLUMN "mock_test_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_attempts" DROP CONSTRAINT IF EXISTS "mock_attempts_mock_test_id_mock_tests_id_fk";--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD CONSTRAINT "mock_attempts_mock_test_id_mock_tests_id_fk" FOREIGN KEY ("mock_test_id") REFERENCES "public"."mock_tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Snapshot of what the attempt was taken against, copied at start time so an
-- orphaned attempt is still readable without the mock row.
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "mock_snapshot" jsonb;
