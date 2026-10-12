-- Media lessons: video AND audio as first-class content (Phase 2, §27, §28, §29).
--
-- TED / Podcast items already live in `video_lessons` (provider reference,
-- transcript, notes, authored questions, vocabulary ingested into the canonical
-- lexical system). Two things were missing for them to be content like everything
-- else:
--
--   1. `media_kind` — a Podcast episode is an AUDIO lesson, not a video with a
--      missing picture. The kind decides which content type the item's revision is
--      recorded under (`video_lesson` / `audio_lesson`) and which renderer the
--      learner gets.
--   2. `source_ref` — stable identity, so re-authoring the same item revises it
--      instead of creating a second copy, and so a lesson block or an assignment
--      can reference it.
--
-- Additive and backwards compatible: every existing row is a video lesson, which is
-- what the default says.

ALTER TABLE "video_lessons" ADD COLUMN IF NOT EXISTS "media_kind" varchar(10) DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_lessons" ADD COLUMN IF NOT EXISTS "source_ref" varchar(80);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_lessons_source_ref_idx" ON "video_lessons" USING btree ("source_ref") WHERE "source_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_lessons_media_kind_idx" ON "video_lessons" USING btree ("media_kind","publication_state");
