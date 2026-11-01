-- Forward-only RIWI Speaking AI Sessions, Fenced Evaluation & Online Activity Baseline Migration (ported from LEGACY_RIWI 0046, 0047, 0049, 0050)
--> statement-breakpoint
CREATE TABLE "speaking_ai_session_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"prompt_id" uuid NOT NULL,
	"part" "speaking_part" NOT NULL,
	"topic_key" varchar(240) NOT NULL,
	"topic_position" integer NOT NULL,
	"question_position" integer NOT NULL,
	"attempt_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speaking_ai_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" varchar(12) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"session_seed" varchar(80) NOT NULL,
	"plan_version" integer DEFAULT 1 NOT NULL,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_item_index" integer DEFAULT 0 NOT NULL,
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
ALTER TABLE "speaking_ai_session_items" ADD CONSTRAINT "speaking_ai_session_items_prompt_id_speaking_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."speaking_prompts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_ai_session_items" ADD CONSTRAINT "speaking_ai_session_items_attempt_id_speaking_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."speaking_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_ai_sessions" ADD CONSTRAINT "speaking_ai_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "speaking_ai_session_items_session_ordinal_uidx" ON "speaking_ai_session_items" USING btree ("session_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "speaking_ai_session_items_session_prompt_uidx" ON "speaking_ai_session_items" USING btree ("session_id","prompt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "speaking_ai_session_items_attempt_uidx" ON "speaking_ai_session_items" USING btree ("attempt_id") WHERE "speaking_ai_session_items"."attempt_id" is not null;--> statement-breakpoint
CREATE INDEX "speaking_ai_sessions_user_status_idx" ON "speaking_ai_sessions" USING btree ("user_id","status","created_at");--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_retry_of_attempt_id_speaking_attempts_id_fk" FOREIGN KEY ("retry_of_attempt_id") REFERENCES "public"."speaking_attempts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "ai_session_id" uuid;--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "ai_session_item_id" uuid;--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_ai_session_id_speaking_ai_sessions_id_fk" FOREIGN KEY ("ai_session_id") REFERENCES "public"."speaking_ai_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_attempts_ai_session_item_id_speaking_ai_session_items_id_fk" FOREIGN KEY ("ai_session_item_id") REFERENCES "public"."speaking_ai_session_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Existing last_active_at values were not maintained by authenticated site use.
-- Start the seven-day offline clock at rollout rather than deleting active users' chats.
-- Apply once through the migration journal before enabling the new retention job.
-- Current site already maintains last_active_at. Preserve accepted historical values.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_online_activity_idx ON users (last_active_at, id);
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "recording_sha256" varchar(64);
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "evaluation_claim_token" uuid;
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "evaluation_claim_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_recording_sha256_check" CHECK ("recording_sha256" IS NULL OR "recording_sha256" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_evaluation_claim_pair_check" CHECK (("evaluation_claim_token" IS NULL) = ("evaluation_claim_expires_at" IS NULL));
