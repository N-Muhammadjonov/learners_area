CREATE TABLE IF NOT EXISTS "typing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"target_chars" integer NOT NULL,
	"typed_chars" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"wpm" numeric(6, 1) NOT NULL,
	"accuracy" numeric(5, 1) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "typing_runs" ADD CONSTRAINT "typing_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
