CREATE TYPE "public"."grammar_activity" AS ENUM('correct_it', 'translate_it', 'activate_it');--> statement-breakpoint
ALTER TABLE "grammar_attempts" ALTER COLUMN "selected_option" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "grammar_attempts" ADD COLUMN "activity" "grammar_activity" DEFAULT 'correct_it' NOT NULL;--> statement-breakpoint
ALTER TABLE "grammar_attempts" ADD COLUMN "response_text" text;--> statement-breakpoint
ALTER TABLE "grammar_exercises" ADD COLUMN "translate_prompt_uz" text;--> statement-breakpoint
ALTER TABLE "grammar_exercises" ADD COLUMN "target_structures" jsonb;--> statement-breakpoint
ALTER TABLE "grammar_exercises" ADD COLUMN "activation_prompt" text;