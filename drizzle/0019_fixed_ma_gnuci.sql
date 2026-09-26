CREATE TYPE "public"."telegram_broadcast_delivery_status" AS ENUM('success', 'blocked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."telegram_broadcast_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."telegram_login_intent_status" AS ENUM('pending', 'confirmed', 'consumed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."telegram_message_sender_type" AS ENUM('user', 'admin', 'owner', 'bot');--> statement-breakpoint
CREATE TYPE "public"."telegram_message_type" AS ENUM('text', 'photo', 'document', 'voice', 'audio', 'link');--> statement-breakpoint
CREATE TYPE "public"."telegram_support_thread_status" AS ENUM('open', 'waiting_for_user', 'waiting_for_staff', 'closed');--> statement-breakpoint
CREATE TABLE "telegram_bot_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"linked_user_id" uuid,
	"permissions" jsonb DEFAULT '[]' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_bot_admins_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_broadcast_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"status" "telegram_broadcast_delivery_status" NOT NULL,
	"error_message" text,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid,
	"audience" varchar(64) NOT NULL,
	"message_type" "telegram_message_type" DEFAULT 'text' NOT NULL,
	"content" text,
	"status" "telegram_broadcast_status" DEFAULT 'queued' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"chat_id" varchar(64) NOT NULL,
	"username" varchar(120),
	"first_name" varchar(120),
	"last_name" varchar(120),
	"language_code" varchar(10),
	"linked_user_id" uuid,
	"bot_blocked_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_contacts_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_login_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"browser_nonce_hash" text NOT NULL,
	"telegram_user_id" varchar(64),
	"user_id" uuid,
	"status" "telegram_login_intent_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_type" "telegram_message_sender_type" NOT NULL,
	"sender_user_id" uuid,
	"sender_telegram_id" varchar(64),
	"message_type" "telegram_message_type" DEFAULT 'text' NOT NULL,
	"text" text,
	"telegram_file_id" text,
	"resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_support_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"linked_user_id" uuid,
	"assigned_admin_id" uuid,
	"status" "telegram_support_thread_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "telegram_bot_admins" ADD CONSTRAINT "telegram_bot_admins_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bot_admins" ADD CONSTRAINT "telegram_bot_admins_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_broadcast_deliveries" ADD CONSTRAINT "telegram_broadcast_deliveries_broadcast_id_telegram_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."telegram_broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_broadcasts" ADD CONSTRAINT "telegram_broadcasts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_contacts" ADD CONSTRAINT "telegram_contacts_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_login_intents" ADD CONSTRAINT "telegram_login_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_support_messages" ADD CONSTRAINT "telegram_support_messages_thread_id_telegram_support_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."telegram_support_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_support_messages" ADD CONSTRAINT "telegram_support_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_support_threads" ADD CONSTRAINT "telegram_support_threads_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_support_threads" ADD CONSTRAINT "telegram_support_threads_assigned_admin_id_users_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;