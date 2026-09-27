CREATE TYPE "public"."ownership_transfer_challenge_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'consumed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."telegram_owner_handover_status" AS ENUM('pending', 'current_confirmed', 'rejected', 'expired', 'consumed', 'cancelled');--> statement-breakpoint
CREATE TABLE "ownership_transfer_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"requested_keep_role" varchar(16) NOT NULL,
	"purpose" varchar(40) DEFAULT 'website_owner_transfer' NOT NULL,
	"telegram_user_id" varchar(64) NOT NULL,
	"browser_nonce_hash" text NOT NULL,
	"include_bot_handover" boolean DEFAULT false NOT NULL,
	"target_telegram_id" varchar(64),
	"status" "ownership_transfer_challenge_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_owner_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_telegram_id" varchar(64) NOT NULL,
	"to_telegram_id" varchar(64) NOT NULL,
	"initiated_by_user_id" uuid,
	"status" "telegram_owner_handover_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"current_confirmed_at" timestamp with time zone,
	"target_confirmed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ownership_transfer_challenges" ADD CONSTRAINT "ownership_transfer_challenges_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfer_challenges" ADD CONSTRAINT "ownership_transfer_challenges_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_owner_handovers" ADD CONSTRAINT "telegram_owner_handovers_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ownership_transfer_challenges_from_status_idx" ON "ownership_transfer_challenges" USING btree ("from_user_id","status");--> statement-breakpoint
CREATE INDEX "telegram_owner_handovers_from_idx" ON "telegram_owner_handovers" USING btree ("from_telegram_id","status");