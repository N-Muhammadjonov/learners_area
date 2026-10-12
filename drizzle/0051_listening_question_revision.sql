-- 0051 Listening question SETS are version-bound.
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027, so `drizzle-kit generate` would regenerate the whole schema instead of a
-- delta.
--
-- WHAT DEFECT THIS CLOSES
--
--   `listening_questions` was keyed only by `test_id`. Publishing a revised
--   Listening item therefore had no way to hold two sets of questions at once: the
--   author replaced the set in place (DELETE + INSERT). Because
--   `listening_answers.question_id` references `listening_questions(id)`
--   ON DELETE CASCADE, replacing the set DELETED the questions, which CASCADED to
--   the answers of every historical attempt. A learner's score survived in
--   `listening_attempts`, but the per-question review behind it was gone — and a
--   learner who was mid-attempt could resume into DIFFERENT questions.
--
--   The same in-place write also let a DRAFT revision silently change the PUBLISHED
--   row: saving a draft mutated the live title/audio/transcript and replaced the live
--   questions, so "editing a draft" was really "editing production".
--
-- WHY A COLUMN ON `listening_questions` (and not a new table)
--
--   The question text, options, key and explanation already live here, and the
--   attempt → revision binding already exists (`listening_attempts.content_version_id`,
--   written at attempt start). What was missing is the same identity on the QUESTION
--   side, so "the set of questions revision N published" is expressible. A new table
--   would duplicate the question shape and force every existing reader to change at
--   once; a nullable discriminator lets readers migrate one at a time and keeps
--   legacy content working exactly as it does today.
--
-- WHY NULLABLE, AND WHAT NULL MEANS
--
--   NULL = "the legacy set": rows written before this migration, and rows of items
--   that were never published through the CMS. Readers resolve an item to
--   "the published revision's set, else the NULL set" — so every existing test keeps
--   the set it has always had, and nothing needs backfilling.
--
-- WHY ON DELETE SET NULL
--
--   Deleting a revision must never delete questions (and through them, answers).
--   Losing the LABEL is recoverable; losing a learner's review is not.
--
-- This migration is additive: one nullable column, one index, no row rewritten, no
-- constraint tightened on existing data, no backfill.
ALTER TABLE "listening_questions" ADD COLUMN IF NOT EXISTS "content_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "listening_questions" DROP CONSTRAINT IF EXISTS "listening_questions_content_version_id_content_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "listening_questions" ADD CONSTRAINT "listening_questions_content_version_id_content_versions_id_fk"
  FOREIGN KEY ("content_version_id") REFERENCES "public"."content_versions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
-- Readers ask for one item's set (a published revision, or the NULL set), which is
-- exactly this pair; the existing indexes only cover `test_id` alone.
CREATE INDEX IF NOT EXISTS "listening_questions_version_set_idx"
  ON "listening_questions" ("test_id","content_version_id");
