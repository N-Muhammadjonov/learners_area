-- 0041 Content versions + attempt version binding (+ score policy versioning).
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027 (0028-0040 were hand-written too), so `drizzle-kit generate` would
-- re-emit the whole schema instead of a delta.
--
-- Why this exists (Master Prompt 2 §13, §22, §33, §42, §71, §72):
--   • an EDIT of an answer key, prompt or question wording must never silently
--     change what a historical attempt appears to have tested;
--   • a formal composition (mock, sectional mock) must reference an EXACT
--     version, so composing it twice cannot pick up a later edit;
--   • a raw score must be convertible to a band by a policy that is versioned,
--     so an old result keeps the conversion that was valid for it.
--
--  1. content_versions                 — one immutable row per accepted content
--                                        revision, keyed by module + contentType +
--                                        sourceRef + version number.
--  2. attempt binding columns          — every assessment attempt records the
--                                        content version it started with.
--  3. score_policy_version columns      — a result records the conversion policy
--                                        that produced its band.
CREATE TYPE "public"."content_version_status" AS ENUM('draft', 'published', 'superseded', 'archived');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module" varchar(20) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"source_ref" varchar(80) NOT NULL,
	"version_no" integer NOT NULL,
	"status" "content_version_status" DEFAULT 'draft' NOT NULL,
	"title" varchar(200) NOT NULL,
	"track" varchar(24) DEFAULT 'unspecified' NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"semantic_hash" varchar(64) NOT NULL,
	"answer_key_hash" varchar(64) NOT NULL,
	"publication_state" varchar(16) DEFAULT 'draft' NOT NULL,
	"target_type" varchar(40),
	"target_id" uuid,
	"content_import_id" uuid,
	"created_by_user_id" uuid,
	"change_kind" varchar(24) DEFAULT 'created' NOT NULL,
	"provenance" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"superseded_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_content_import_id_content_imports_id_fk" FOREIGN KEY ("content_import_id") REFERENCES "public"."content_imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_versions_identity_idx" ON "content_versions" USING btree ("module","content_type","source_ref","version_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_versions_target_idx" ON "content_versions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_versions_ref_idx" ON "content_versions" USING btree ("module","content_type","source_ref","status");--> statement-breakpoint
ALTER TABLE "listening_attempts" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;--> statement-breakpoint
ALTER TABLE "listening_attempts" ADD COLUMN IF NOT EXISTS "score_policy_version" varchar(24);--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN IF NOT EXISTS "score_policy_version" varchar(24);--> statement-breakpoint
ALTER TABLE "writing_submissions" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN IF NOT EXISTS "score_policy_version" varchar(24);--> statement-breakpoint
-- A version that is deleted must not take an attempt with it: the binding is a
-- historical fact, and a missing version degrades to "unknown version", never to
-- a lost attempt.
ALTER TABLE "listening_attempts" ADD CONSTRAINT "listening_attempts_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD CONSTRAINT "reading_attempts_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_submissions" ADD CONSTRAINT "writing_submissions_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_content_version_id_content_versions_id_fk" FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;
