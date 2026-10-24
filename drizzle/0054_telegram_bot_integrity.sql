CREATE TYPE "public"."telegram_outbox_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'blocked', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."telegram_broadcast_delivery_status" ADD VALUE 'queued' BEFORE 'blocked';--> statement-breakpoint
ALTER TYPE "public"."telegram_broadcast_delivery_status" ADD VALUE 'sending' BEFORE 'blocked';--> statement-breakpoint
ALTER TYPE "public"."telegram_broadcast_delivery_status" ADD VALUE 'sent' BEFORE 'blocked';--> statement-breakpoint
ALTER TYPE "public"."telegram_broadcast_delivery_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "telegram_bot_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_telegram_id" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "telegram_deletion_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"target_user_id" uuid NOT NULL,
	"actor_telegram_id" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_direct_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_telegram_id" varchar(64) NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid NOT NULL,
	"target_telegram_id" varchar(64),
	"body" text NOT NULL,
	"status" "telegram_outbox_status" DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"telegram_message_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"category" varchar(20) NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"status" "telegram_outbox_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"error_message" text,
	"correlation_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_processed_updates" (
	"update_id" varchar(32) PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_bot_admins" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "telegram_broadcast_deliveries" ALTER COLUMN "delivered_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "telegram_broadcast_deliveries" ALTER COLUMN "delivered_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_bot_admins" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_broadcast_deliveries" ADD COLUMN "chat_id" varchar(64);--> statement-breakpoint
ALTER TABLE "telegram_broadcast_deliveries" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_broadcast_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_broadcast_deliveries" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_broadcast_deliveries" ADD COLUMN "telegram_message_id" varchar(64);--> statement-breakpoint
ALTER TABLE "telegram_broadcasts" ADD COLUMN "actor_telegram_id" varchar(64);--> statement-breakpoint
ALTER TABLE "telegram_broadcasts" ADD COLUMN "sent_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_broadcasts" ADD COLUMN "failed_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_broadcasts" ADD COLUMN "blocked_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_contacts" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_contacts" ADD COLUMN "locale_override" varchar(5);--> statement-breakpoint
ALTER TABLE "telegram_contacts" ADD COLUMN "notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_support_messages" ADD COLUMN "file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "telegram_support_messages" ADD COLUMN "mime_type" varchar(120);--> statement-breakpoint
ALTER TABLE "telegram_support_messages" ADD COLUMN "delivery_status" varchar(20);--> statement-breakpoint
ALTER TABLE "telegram_support_messages" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "telegram_support_threads" ADD COLUMN "assigned_telegram_id" varchar(64);--> statement-breakpoint
ALTER TABLE "telegram_support_threads" ADD COLUMN "last_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_deletion_intents" ADD CONSTRAINT "telegram_deletion_intents_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_direct_messages" ADD CONSTRAINT "telegram_direct_messages_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_direct_messages" ADD CONSTRAINT "telegram_direct_messages_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_deletion_intents_token_idx" ON "telegram_deletion_intents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "telegram_direct_messages_target_idx" ON "telegram_direct_messages" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_notifications_status_idx" ON "telegram_notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_broadcast_deliveries_target_idx" ON "telegram_broadcast_deliveries" USING btree ("broadcast_id","telegram_user_id");--> statement-breakpoint
CREATE INDEX "telegram_broadcast_deliveries_status_idx" ON "telegram_broadcast_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_contacts_linked_user_idx" ON "telegram_contacts" USING btree ("linked_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_login_intents_token_hash_idx" ON "telegram_login_intents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "telegram_login_intents_status_expires_idx" ON "telegram_login_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "telegram_support_messages_thread_idx" ON "telegram_support_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_support_threads_user_status_idx" ON "telegram_support_threads" USING btree ("telegram_user_id","status");--> statement-breakpoint
CREATE INDEX "telegram_support_threads_status_idx" ON "telegram_support_threads" USING btree ("status","updated_at");
