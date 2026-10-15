-- Change authored-content foreign keys without losing any learner history.
-- This migration does NOT purge existing archived content automatically.
ALTER TABLE "retention_attempts" ADD COLUMN "retention_label_snapshot" varchar(20);--> statement-breakpoint
UPDATE "retention_attempts" a SET "retention_label_snapshot" = t."internal_label"
  FROM "retention_texts" t WHERE a."retention_text_id" = t."id"
  AND a."retention_label_snapshot" IS NULL;--> statement-breakpoint
ALTER TABLE "retention_attempts" ALTER COLUMN "retention_text_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retention_attempts" ALTER COLUMN "retention_text_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retention_attempts" DROP CONSTRAINT "retention_attempts_retention_text_id_retention_texts_id_fk";--> statement-breakpoint
ALTER TABLE "retention_attempts" DROP CONSTRAINT "retention_attempts_retention_text_version_id_retention_text_versions_id_fk";--> statement-breakpoint
ALTER TABLE "retention_attempts" ADD CONSTRAINT "retention_attempts_retention_text_id_retention_texts_id_fk"
 FOREIGN KEY ("retention_text_id") REFERENCES "public"."retention_texts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_attempts" ADD CONSTRAINT "retention_attempts_retention_text_version_id_retention_text_versions_id_fk"
 FOREIGN KEY ("retention_text_version_id") REFERENCES "public"."retention_text_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
