CREATE TYPE "public"."video_lesson_stage" AS ENUM('comprehension', 'gap_fill');--> statement-breakpoint
CREATE TYPE "public"."video_lesson_state" AS ENUM('not_started', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "video_lesson_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"video_lesson_id" uuid NOT NULL,
	"state" "video_lesson_state" DEFAULT 'not_started' NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"answers" jsonb,
	"response_text" text,
	"summary_text" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "video_lesson_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_lesson_id" uuid NOT NULL,
	"stage" "video_lesson_stage" NOT NULL,
	"position" integer NOT NULL,
	"prompt" text NOT NULL,
	"accepted_answers" jsonb NOT NULL,
	"at_seconds" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "video_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"provider" varchar(30) DEFAULT 'youtube' NOT NULL,
	"video_id" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"before_you_watch" text,
	"duration_seconds" integer,
	"transcript" jsonb,
	"transcript_source" varchar(20),
	"transcript_attribution" varchar(200),
	"created_by_user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_lesson_progress" ADD CONSTRAINT "video_lesson_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_lesson_progress" ADD CONSTRAINT "video_lesson_progress_video_lesson_id_video_lessons_id_fk" FOREIGN KEY ("video_lesson_id") REFERENCES "public"."video_lessons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_lesson_questions" ADD CONSTRAINT "video_lesson_questions_video_lesson_id_video_lessons_id_fk" FOREIGN KEY ("video_lesson_id") REFERENCES "public"."video_lessons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_lessons" ADD CONSTRAINT "video_lessons_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_lessons" ADD CONSTRAINT "video_lessons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_lesson_progress_user_idx" ON "video_lesson_progress" USING btree ("user_id","video_lesson_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_lesson_questions_lesson_idx" ON "video_lesson_questions" USING btree ("video_lesson_id","stage","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_lessons_lesson_idx" ON "video_lessons" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "video_lessons_video_idx" ON "video_lessons" USING btree ("provider","video_id");