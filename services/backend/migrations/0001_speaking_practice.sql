CREATE TYPE "public"."speaking_attempt_status" AS ENUM('recording', 'submitted', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."speaking_part" AS ENUM('part1', 'part2', 'part3', 'general');--> statement-breakpoint
ALTER TYPE "public"."upload_purpose" ADD VALUE 'speaking_recording';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "speaking_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt_id" uuid,
	"part" "speaking_part" NOT NULL,
	"status" "speaking_attempt_status" DEFAULT 'recording' NOT NULL,
	"recording_object_key" text,
	"recording_original_name" varchar(255),
	"recording_mime_type" varchar(120),
	"recording_size" integer,
	"recording_duration_ms" integer,
	"transcript" text,
	"transcript_provider" varchar(60),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "speaking_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part" "speaking_part" NOT NULL,
	"category" "speaking_category" NOT NULL,
	"prompt_text" text NOT NULL,
	"cue_card" text,
	"prep_seconds" integer DEFAULT 30 NOT NULL,
	"answer_seconds" integer DEFAULT 90 NOT NULL,
	"follow_ups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "speaking_attempt_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_prompt_id_speaking_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."speaking_prompts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
