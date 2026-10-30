-- 0052 A Listening item can belong to a PROGRAM at an explicit ordinal.
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at 0027, so
-- `drizzle-kit generate` would regenerate the whole schema instead of a delta.
--
-- WHAT THIS CLOSES
--
--   The dedicated Listening MCQ programme is DAY 1 → DAY 30, five questions per day. A Day is a
--   canonical Listening item: one `listening_tests` row, its own `listening_questions` (the five
--   MCQs, in their authored order), its own content revisions and its own audio — exactly the shape
--   a General Listening SECTION already has. The learner's staged work is already persisted per
--   (user, question) by `listening_mcq_sessions`, so nothing about progress is missing.
--
--   What was missing is the RELATION: which programme an item belongs to, and WHICH DAY it is. The
--   only existing place to say "this is an MCQ item" was the package's `collection`, which states
--   the PRODUCT (`mcq`) but cannot distinguish Day 4 from Day 5, cannot order them, and would force
--   the day number to be parsed back out of a title — the one thing the owner forbade.
--
-- WHY TWO COLUMNS AND NOT THREE TABLES
--
--   A `programs → days → day_questions` model would need a container item anyway (questions are
--   owned by an item: `listening_questions.test_id`), so the membership table would restate the
--   item's own question set, and the day's position would exist TWICE — in the membership row and
--   in `listening_questions.order` — with no way to keep the two truths from drifting. The
--   `order` column is already this product's single ordering truth (attempts, review, practice and
--   the MCQ drill all read it). So the day's membership and its position are ALREADY expressible;
--   only the programme relation was not. Two nullable columns close exactly that gap, and leave one
--   order truth in the system.
--
-- WHY NULLABLE, AND WHAT NULL MEANS
--
--   NULL = "this item is not part of a programme" — every existing Listening row, every Academic
--   full test, every General section, unchanged. Nothing needs backfilling, no reader has to change
--   at once, and a row that never joins a programme keeps its current behaviour exactly.
--
-- WHY THE GUARDS ARE STRICTER THAN "TWO COLUMNS"
--
--   • both-or-neither: a programme reference without a position (or a position without a programme)
--     is an incomplete statement about a learner-visible day, and no code should have to guess which
--     half is missing;
--   • ordinal >= 1: "DAY 0" is not a day;
--   • UNIQUE (program_ref, program_ordinal): the database refuses a second item claiming the same
--     day of the same programme, so a duplicated or re-run import cannot silently create two Day 6s.
--
-- Additive: two nullable columns, three guarded constraints, two indexes. No row rewritten, no
-- existing constraint tightened, no backfill, nothing deleted.
ALTER TABLE "listening_tests" ADD COLUMN IF NOT EXISTS "program_ref" varchar(80);
--> statement-breakpoint
ALTER TABLE "listening_tests" ADD COLUMN IF NOT EXISTS "program_ordinal" integer;
--> statement-breakpoint
ALTER TABLE "listening_tests" DROP CONSTRAINT IF EXISTS "listening_tests_program_pair_check";
--> statement-breakpoint
ALTER TABLE "listening_tests" ADD CONSTRAINT "listening_tests_program_pair_check"
  CHECK (("program_ref" IS NULL) = ("program_ordinal" IS NULL));
--> statement-breakpoint
ALTER TABLE "listening_tests" DROP CONSTRAINT IF EXISTS "listening_tests_program_ordinal_positive_check";
--> statement-breakpoint
ALTER TABLE "listening_tests" ADD CONSTRAINT "listening_tests_program_ordinal_positive_check"
  CHECK ("program_ordinal" IS NULL OR "program_ordinal" >= 1);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listening_tests_program_ordinal_idx"
  ON "listening_tests" ("program_ref","program_ordinal")
  WHERE "program_ref" IS NOT NULL AND "program_ordinal" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listening_tests_program_idx"
  ON "listening_tests" ("program_ref")
  WHERE "program_ref" IS NOT NULL;
