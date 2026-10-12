ALTER TABLE "video_lessons" ALTER COLUMN "lesson_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "video_lessons" ADD COLUMN "transcript_text" text;