-- 0049 Private lesson student notes ("Xulosangiz").
--
-- Hand-written on purpose: the drizzle snapshot chain in this repository stops at
-- 0027, so `drizzle-kit generate` would regenerate the whole schema instead of a
-- delta.
--
-- WHY A DEDICATED TABLE RATHER THAN lesson_progress.notes
--
--   * Privacy by construction. `lesson_progress.notes` is selected by ordinary
--     progress reads (src/lib/data/roadmap.ts renders it) — private learner text in
--     a progress row can be exposed by any future query that widens its SELECT.
--     A note that lives in its own table cannot leak through a progress read.
--   * Truthfulness. A note is not progress: writing one must never create the
--     impression that a lesson was started or completed. Here a note row carries no
--     state and touches nothing else.
--   * Race safety. `lesson_progress` has NO unique key on (user_id, lesson_id), so
--     its notes path is a read-then-write upsert: two concurrent saves can create
--     two rows and `findFirst` may return either. `lesson_notes` is keyed by a
--     unique index, so ON CONFLICT makes the save atomic (upsert semantics).
--
-- Identity is (user_id, lesson_id): `lessons.id` is the stable LOGICAL lesson
-- (revisions live in content_versions and the row keeps its identity across them),
-- so a new revision does not orphan the learner's note. Never keyed by title.
--
-- Ownership is enforced in the service layer, which only ever queries by the
-- session user's id; this table deliberately has no "author" column to confuse
-- with "reader". Learner history is not cascade-deleted by content edits: the
-- lesson FK cascades only when the lesson row itself is deleted, exactly like
-- `lesson_progress`.
CREATE TABLE IF NOT EXISTS "lesson_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "lesson_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- One note per learner per lesson: this index IS the upsert contract.
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_notes_user_lesson_uq" ON "lesson_notes" ("user_id","lesson_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lesson_notes_lesson_idx" ON "lesson_notes" ("lesson_id");
--> statement-breakpoint
-- A note is bounded text, never a second content store (matches the 4,000-character
-- limit the lesson-note API enforces) and never empty: clearing a note deletes the
-- row, so "a row exists" always means "there is something to read".
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_body_len_chk" CHECK (char_length("body") BETWEEN 1 AND 4000);
--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_body_not_blank_chk" CHECK (btrim("body") <> '');
--> statement-breakpoint
-- Move existing course-lesson notes ("My notes") into the private table so nobody
-- loses writing they already did. This is the point of the dedicated table: the
-- same text stops living in a progress row that ordinary progress reads render.
-- The legacy column is cleared ONLY for rows whose text is verifiably present in
-- lesson_notes, so a partial or failed copy cannot destroy anything.
INSERT INTO "lesson_notes" ("user_id", "lesson_id", "body", "created_at", "updated_at")
SELECT "user_id", "lesson_id", "notes", now(), "updated_at"
FROM "lesson_progress"
WHERE "notes" IS NOT NULL AND btrim("notes") <> ''
ON CONFLICT ("user_id", "lesson_id") DO NOTHING;
--> statement-breakpoint
UPDATE "lesson_progress" AS p
SET "notes" = NULL
WHERE p."notes" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "lesson_notes" AS n
    WHERE n."user_id" = p."user_id" AND n."lesson_id" = p."lesson_id" AND n."body" = p."notes"
  );
