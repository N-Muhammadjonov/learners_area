-- Authoring identity + canonical question type codes (Phase 2, §38/§43/§41).
--
-- Three small gaps that authoring exposed, none of them a redesign:
--
--   1. A listening QUESTION could not record WHICH of the 14 canonical Listening
--      types it is: the storage enum only knows multiple_choice/short_answer, so
--      "practise Matching Features" was unrecoverable for hand-authored material
--      (imported material kept the type inside the package). `type_code` holds the
--      canonical type id, exactly like reading_questions already does.
--   2. A listening TEST had no stable source identity, while reading passages and
--      speaking prompts both do. A versioned content row needs something to be the
--      version OF, and re-authoring the same test must not create a second copy.
--   3. Grammar topics and writing prompts had no `source_ref`, so the authored
--      versions of them could not be pinned to the row they describe.
--
-- Additive only: no column is dropped, no row is rewritten, and every new column
-- is nullable except grammar_topics.publication_state, whose default 'published'
-- keeps existing topics visible exactly as they are today.

ALTER TABLE "listening_questions" ADD COLUMN IF NOT EXISTS "type_code" varchar(40);--> statement-breakpoint
ALTER TABLE "listening_tests" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);--> statement-breakpoint
ALTER TABLE "writing_prompts" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);--> statement-breakpoint
ALTER TABLE "grammar_topics" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);--> statement-breakpoint
ALTER TABLE "grammar_topics" ADD COLUMN IF NOT EXISTS "publication_state" "publication_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listening_tests_source_ref_idx" ON "listening_tests" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "writing_prompts_source_ref_idx" ON "writing_prompts" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grammar_topics_source_ref_idx" ON "grammar_topics" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listening_questions_type_code_idx" ON "listening_questions" USING btree ("type_code");--> statement-breakpoint
-- Canonical Reading type ids are longer than the 16 characters the imported
-- library's short source codes needed ("true_false_not_given" is 20), and a
-- hand-authored question has only its canonical id to go by.
ALTER TABLE "reading_questions" ALTER COLUMN "type_code" TYPE varchar(40);--> statement-breakpoint
-- A pinned revision must be READABLE, not just hashable: composition and review
-- re-read the content a learner actually sat, so the canonical content of every
-- revision is stored alongside its hashes (§71). Bounded: one row per revision,
-- never per attempt, and revisions are created by staff, not by traffic.
ALTER TABLE "content_versions" ADD COLUMN IF NOT EXISTS "content_snapshot" jsonb;
