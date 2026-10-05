CREATE TABLE "speaking_ai_session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"prompt_id" uuid,
	"part" "speaking_part" NOT NULL,
	"topic_key" varchar(200) NOT NULL,
	"topic_title" varchar(200),
	"topic_position" integer NOT NULL,
	"question_position" integer NOT NULL,
	"cluster_size" integer NOT NULL,
	"is_cue_card" boolean DEFAULT false NOT NULL,
	"attempt_id" uuid,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speaking_ai_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" varchar(12) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"plan_version" integer DEFAULT 1 NOT NULL,
	"session_seed" integer NOT NULL,
	"current_item_index" integer DEFAULT 0 NOT NULL,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ALTER COLUMN "transcript_origin" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "transcript_raw" text;--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "transcript_edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "transcript_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "retry_of_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "speaking_ai_session_items" ADD CONSTRAINT "speaking_ai_session_items_session_id_speaking_ai_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."speaking_ai_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_ai_session_items" ADD CONSTRAINT "speaking_ai_session_items_prompt_id_speaking_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."speaking_prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_ai_session_items" ADD CONSTRAINT "speaking_ai_session_items_attempt_id_speaking_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."speaking_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_ai_sessions" ADD CONSTRAINT "speaking_ai_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "speaking_ai_session_items_session_ordinal_idx" ON "speaking_ai_session_items" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE INDEX "speaking_ai_session_items_attempt_idx" ON "speaking_ai_session_items" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "speaking_ai_sessions_user_created_idx" ON "speaking_ai_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_retry_of_attempt_id_speaking_attempts_id_fk" FOREIGN KEY ("retry_of_attempt_id") REFERENCES "public"."speaking_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "speaking_attempts_retry_of_idx" ON "speaking_attempts" USING btree ("retry_of_attempt_id");