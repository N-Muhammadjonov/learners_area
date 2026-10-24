CREATE TABLE IF NOT EXISTS "vocab_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vocab_point_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"ref_type" varchar(40),
	"ref_id" varchar(80),
	"points" integer NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD COLUMN "topic_pack" varchar(60);--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD COLUMN "sense_key" varchar(200);--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD COLUMN "srs_stage" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD COLUMN "mastery" varchar(20) DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_vocabulary" ADD COLUMN "mastered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vocabulary_usages" ADD COLUMN "origin" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary_usages" ADD COLUMN "riwi_accepted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary_usages" ADD COLUMN "evaluation_id" uuid;--> statement-breakpoint
ALTER TABLE "vocabulary_usages" ADD COLUMN "points_awarded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vocab_folders" ADD CONSTRAINT "vocab_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vocab_point_events" ADD CONSTRAINT "vocab_point_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vocab_folders_owner_name_idx" ON "vocab_folders" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vocab_point_events_dedupe_idx" ON "vocab_point_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vocab_point_events_user_idx" ON "vocab_point_events" USING btree ("user_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_vocabulary" ADD CONSTRAINT "user_vocabulary_folder_id_vocab_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."vocab_folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_vocabulary_user_idx" ON "user_vocabulary" USING btree ("user_id","next_review_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_vocabulary_sense_idx" ON "user_vocabulary" USING btree ("user_id","sense_key");