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
--> statement-breakpoint
-- Stable labels must never be reused after their last authored text is deleted.
CREATE TABLE "retention_sequence_counters" (
  "level" "retention_level" PRIMARY KEY NOT NULL,
  "last_sequence" integer NOT NULL CHECK ("last_sequence" >= 0)
);--> statement-breakpoint
INSERT INTO "retention_sequence_counters" ("level","last_sequence")
  SELECT "level", max("sequence")::int FROM "retention_texts" GROUP BY "level"
  ON CONFLICT ("level") DO UPDATE SET
    "last_sequence" = greatest("retention_sequence_counters"."last_sequence", excluded."last_sequence");--> statement-breakpoint
-- Historical content may already have been removed by the owner from Supabase.
-- Preserve its previously issued labels using the durable, metadata-only audit log;
-- neither learner results nor the deleted source text are restored.
INSERT INTO "retention_sequence_counters" ("level","last_sequence")
  SELECT (a.metadata ->> 'level')::retention_level AS "level",
         max(split_part(a.metadata ->> 'label', '-', 2)::int) AS "last_sequence"
  FROM "audit_log" a
  WHERE a."action" IN ('retention_text.created', 'retention_text.version_created',
                       'retention_text.archived', 'retention_text.restored',
                       'retention_text.permanently_deleted')
    AND a.metadata ->> 'level' IN ('A2','B1','B2','C1','C2')
    AND a.metadata ->> 'label' ~ '^(A2|B1|B2|C1|C2)-[0-9]{1,9}

    AND split_part(a.metadata ->> 'label', '-', 1) = a.metadata ->> 'level'
  GROUP BY (a.metadata ->> 'level')::retention_level
  ON CONFLICT ("level") DO UPDATE SET
    "last_sequence" = greatest("retention_sequence_counters"."last_sequence", excluded."last_sequence");--> statement-breakpoint
