-- 0040 Structured content imports (canonical Learners Area Content Package ingest).
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops
-- at 0027 (0028-0039 were hand-written too), so `drizzle-kit generate` would
-- regenerate the whole schema instead of a delta.
--
-- Adds:
--   1. content_imports        — the canonical ingest ledger (provenance,
--                               content hash, content version, actor, result)
--   2. listening_packages.legacy_runtime — the EXPLICIT legacy marker, backfilled
--                               from the structural fact (an authoredRuntime
--                               payload), never from a title or a filename.
CREATE TYPE "public"."content_import_status" AS ENUM('validated', 'created', 'updated', 'unchanged', 'rejected', 'converted');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module" varchar(20) NOT NULL,
	"content_type" varchar(40) NOT NULL,
	"schema_version" integer NOT NULL,
	"import_version" integer DEFAULT 1 NOT NULL,
	"source_ref" varchar(80) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"status" "content_import_status" NOT NULL,
	"target_type" varchar(40) NOT NULL,
	"target_id" uuid,
	"actor_user_id" uuid,
	"original_filename" varchar(255),
	"legacy_runtime" boolean DEFAULT false NOT NULL,
	"assets" jsonb,
	"provenance" jsonb,
	"result" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "content_imports" ADD CONSTRAINT "content_imports_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_imports_source_idx" ON "content_imports" USING btree ("module","content_type","source_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_imports_created_idx" ON "content_imports" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "listening_packages" ADD COLUMN IF NOT EXISTS "legacy_runtime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "listening_packages" SET "legacy_runtime" = true WHERE "payload" -> 'authoredRuntime' IS NOT NULL AND "legacy_runtime" = false;
