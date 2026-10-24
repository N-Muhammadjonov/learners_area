CREATE TYPE "public"."publication_state" AS ENUM('draft', 'scheduled', 'published', 'archived');--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "publication_state" "publication_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listening_tests" ADD COLUMN "publication_state" "publication_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "listening_tests" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "publication_state" "publication_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_passages" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "speaking_materials" ADD COLUMN "publication_state" "publication_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "speaking_materials" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "speaking_prompts" ADD COLUMN "publication_state" "publication_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "speaking_prompts" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_lessons" ADD COLUMN "publication_state" "publication_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_lessons" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "writing_prompts" ADD COLUMN "publication_state" "publication_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "writing_prompts" ADD COLUMN "publish_at" timestamp with time zone;

-- Backfill: a row that was switched off under the old boolean is ARCHIVED, not
-- published. The old flag stays in place, but from here on the publication
-- state is what decides visibility.
UPDATE "courses" SET "publication_state" = 'archived' WHERE "is_active" = false;--> statement-breakpoint
UPDATE "listening_tests" SET "publication_state" = 'archived' WHERE "is_active" = false;--> statement-breakpoint
UPDATE "reading_passages" SET "publication_state" = 'archived' WHERE "is_active" = false;--> statement-breakpoint
UPDATE "speaking_materials" SET "publication_state" = 'archived' WHERE "is_active" = false;--> statement-breakpoint
UPDATE "speaking_prompts" SET "publication_state" = 'archived' WHERE "is_active" = false;--> statement-breakpoint
UPDATE "video_lessons" SET "publication_state" = 'archived' WHERE "is_active" = false;--> statement-breakpoint
UPDATE "writing_prompts" SET "publication_state" = 'archived' WHERE "is_active" = false;
