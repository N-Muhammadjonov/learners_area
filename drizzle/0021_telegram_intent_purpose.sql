ALTER TABLE "telegram_login_intents" ADD COLUMN "purpose" varchar(16) DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_login_intents" ADD COLUMN "display_name" varchar(200);--> statement-breakpoint
ALTER TABLE "telegram_login_intents" ADD COLUMN "language_code" varchar(10);--> statement-breakpoint
CREATE TABLE "telegram_flow_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_telegram_id" varchar(64) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telegram_flow_drafts_actor_idx" ON "telegram_flow_drafts" USING btree ("actor_telegram_id","kind");