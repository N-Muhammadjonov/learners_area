CREATE TABLE IF NOT EXISTS "listening_authored_checkpoints" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "test_id" uuid NOT NULL REFERENCES "listening_packages"("test_id") ON DELETE CASCADE,
  "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "attempt_id" uuid REFERENCES "listening_attempts"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "test_id")
);
--> statement-breakpoint
ALTER TABLE "listening_authored_checkpoints" ENABLE ROW LEVEL SECURITY;
