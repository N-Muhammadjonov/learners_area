CREATE TYPE "public"."live_partner_invite_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."live_partner_state" AS ENUM('offline', 'available', 'outgoing_invite', 'incoming_invite', 'connecting', 'in_call', 'reconnecting');--> statement-breakpoint
CREATE TABLE "live_partner_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_partner_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" "live_partner_invite_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "live_partner_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"state" "live_partner_state" DEFAULT 'offline' NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"session_id" uuid,
	"rules_version" integer,
	"rules_accepted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_partner_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" varchar(40),
	"connection_outcome" varchar(40),
	CONSTRAINT "live_partner_sessions_invite_id_unique" UNIQUE("invite_id")
);
--> statement-breakpoint
ALTER TABLE "live_partner_blocks" ADD CONSTRAINT "live_partner_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_partner_blocks" ADD CONSTRAINT "live_partner_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_partner_invites" ADD CONSTRAINT "live_partner_invites_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_partner_invites" ADD CONSTRAINT "live_partner_invites_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_partner_presence" ADD CONSTRAINT "live_partner_presence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_partner_sessions" ADD CONSTRAINT "live_partner_sessions_invite_id_live_partner_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."live_partner_invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_partner_sessions" ADD CONSTRAINT "live_partner_sessions_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_partner_sessions" ADD CONSTRAINT "live_partner_sessions_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_partner_blocks_pair_idx" ON "live_partner_blocks" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_partner_invites_one_pending_from_idx" ON "live_partner_invites" USING btree ("from_user_id") WHERE "live_partner_invites"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "live_partner_invites_to_idx" ON "live_partner_invites" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE INDEX "live_partner_presence_state_idx" ON "live_partner_presence" USING btree ("state","heartbeat_at");