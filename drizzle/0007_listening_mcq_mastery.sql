CREATE TYPE "public"."mcq_mastery_stage" AS ENUM('listen', 'notes', 'committed', 'revealed', 'chosen', 'reasoned');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listening_mcq_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"stage" "mcq_mastery_stage" DEFAULT 'listen' NOT NULL,
	"notes" text,
	"own_answer" text,
	"chosen_answer" text,
	"reasoning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listening_questions" ADD COLUMN "keywords" text;--> statement-breakpoint
ALTER TABLE "listening_questions" ADD COLUMN "paraphrases" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listening_mcq_sessions" ADD CONSTRAINT "listening_mcq_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listening_mcq_sessions" ADD CONSTRAINT "listening_mcq_sessions_test_id_listening_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."listening_tests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listening_mcq_sessions" ADD CONSTRAINT "listening_mcq_sessions_question_id_listening_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."listening_questions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listening_mcq_sessions_user_question_key" ON "listening_mcq_sessions" USING btree ("user_id","question_id");