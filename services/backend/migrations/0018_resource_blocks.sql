CREATE TYPE "public"."resource_owner_type" AS ENUM('lesson', 'reading', 'listening', 'writing', 'speaking', 'grammar', 'assignment', 'live_class');--> statement-breakpoint
CREATE TABLE "resource_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" "resource_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "content_block_type" NOT NULL,
	"text_content" text,
	"link_url" text,
	"object_key" text,
	"original_name" varchar(255),
	"mime_type" varchar(120),
	"size" integer,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_blocks" ADD CONSTRAINT "resource_blocks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_blocks_owner_position_idx" ON "resource_blocks" USING btree ("owner_type","owner_id","position");--> statement-breakpoint
CREATE INDEX "resource_blocks_owner_idx" ON "resource_blocks" USING btree ("owner_type","owner_id");