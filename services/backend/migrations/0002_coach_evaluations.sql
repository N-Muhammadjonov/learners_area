CREATE TYPE "public"."evaluation_type" AS ENUM('writing', 'speaking', 'grammar', 'vocabulary', 'assignment');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TYPE "public"."evaluation_verdict" AS ENUM('correct', 'mostly_correct', 'needs_correction');--> statement-breakpoint
CREATE TYPE "public"."weakness_status" AS ENUM('open', 'improving', 'resolved');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assignment_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coach_weaknesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" varchar(40) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurrence_count" integer DEFAULT 0 NOT NULL,
	"recent_severity" varchar(10) DEFAULT 'low' NOT NULL,
	"status" "weakness_status" DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"evaluation_type" "evaluation_type" NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_id" uuid NOT NULL,
	"provider_id" varchar(60) NOT NULL,
	"provider_display_name" varchar(80) NOT NULL,
	"provider_type" "provider_type" NOT NULL,
	"provider_version" varchar(40) NOT NULL,
	"model" varchar(120),
	"prompt_version" varchar(40) NOT NULL,
	"rubric_version" varchar(40) NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"fallback_from" varchar(60),
	"checked_by_name" varchar(80) NOT NULL,
	"overall_estimate" real,
	"confidence" real DEFAULT 0 NOT NULL,
	"verdict" "evaluation_verdict",
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weaknesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_exercises" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"processed_in_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vocabulary_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_vocabulary_id" uuid NOT NULL,
	"sentence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "transcript_origin" varchar(10);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment_responses" ADD CONSTRAINT "assignment_responses_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignment_responses" ADD CONSTRAINT "assignment_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coach_weaknesses" ADD CONSTRAINT "coach_weaknesses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vocabulary_usages" ADD CONSTRAINT "vocabulary_usages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vocabulary_usages" ADD CONSTRAINT "vocabulary_usages_user_vocabulary_id_user_vocabulary_id_fk" FOREIGN KEY ("user_vocabulary_id") REFERENCES "public"."user_vocabulary"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coach_weaknesses_unique" ON "coach_weaknesses" USING btree ("user_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evaluations_source_unique" ON "evaluations" USING btree ("source_type","source_id");