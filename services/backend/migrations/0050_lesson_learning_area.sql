-- 0050 Lesson learning area + canonical lesson-level Teacher Notes.
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027, so `drizzle-kit generate` would regenerate the whole schema instead of a delta.
--
-- WHY THESE TWO COLUMNS, AND WHY ON `lessons`
--
--   * `learning_area` — what a lesson is ABOUT (listening / reading / writing /
--     speaking / grammar / vocabulary / general). Until now the subject could only be
--     guessed from the media type (an audio block) or from display text (a title
--     containing "Listening"), and both are wrong: an MCQ-strategy lesson taught by a
--     YouTube video is a Listening lesson, and an audio lesson about Reading is not a
--     Listening lesson. The subject is authored, so it is stored.
--
--     Location: the LESSON row, not `course_modules`. A lesson is the unit that is
--     authored, versioned and published, and a course module is a curriculum container
--     whose children may legitimately mix subjects; putting the area on the module
--     would forbid that and would make the area unreachable for a lesson that stands
--     alone. The same column is read by Listening and (later) Reading.
--
--     NULLABLE ON PURPOSE: existing rows are NOT classified. NULL means "not
--     classified yet", which is different from the explicit choice 'general'. No
--     backfill is performed here because the repository holds no unambiguous mapping
--     from (course, module, unit, title) to subject — inferring one would manufacture
--     exactly the false classification this column exists to prevent.
--
--   * `teacher_notes` — the centre's own notes for a lesson. They are lesson metadata,
--     independent of the media type: a video lesson, an audio lesson and a text lesson
--     must all be able to carry them. `video_lessons.notes` keeps its own MEDIA meaning
--     and is untouched (it stays available to a learner surface as a compatibility
--     fallback), but it can no longer be the primary store for lesson notes.
--
-- Both columns are additive and reversible in the sense that nothing existing is
-- rewritten: no row is updated, no column is dropped, no constraint is tightened on
-- existing data.
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "learning_area" varchar(20);
--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "teacher_notes" text;
--> statement-breakpoint
-- The vocabulary is a closed set an author chooses from; NULL stays allowed for
-- historical rows. A CHECK (rather than a pg enum) keeps adding an area later a small
-- additive migration instead of an enum-type dance, and it makes the closed set true in
-- the database, not only in the application.
ALTER TABLE "lessons" DROP CONSTRAINT IF EXISTS "lessons_learning_area_chk";
--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_learning_area_chk"
  CHECK ("learning_area" IS NULL OR "learning_area" IN ('listening','reading','writing','speaking','grammar','vocabulary','general'));
--> statement-breakpoint
-- Teacher notes are authored text, bounded like every other long-form field here, and
-- never blank: clearing them stores NULL rather than an empty string, so "has notes"
-- stays a single unambiguous question.
ALTER TABLE "lessons" DROP CONSTRAINT IF EXISTS "lessons_teacher_notes_len_chk";
--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_teacher_notes_len_chk"
  CHECK ("teacher_notes" IS NULL OR (char_length("teacher_notes") BETWEEN 1 AND 8000 AND btrim("teacher_notes") <> ''));
--> statement-breakpoint
-- A learner-facing lesson library reads one area, live only, newest first, and the
-- existing index set has nothing for that predicate.
CREATE INDEX IF NOT EXISTS "lessons_learning_area_idx" ON "lessons" ("learning_area", "publication_state","updated_at");
--> statement-breakpoint
-- A lesson's teaching material can be a VIDEO, so the upload taxonomy gains a video
-- block kind. Additive to the enum only: no existing intent row changes meaning.
ALTER TYPE "upload_block_kind" ADD VALUE IF NOT EXISTS 'video';
