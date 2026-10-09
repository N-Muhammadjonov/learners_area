ALTER TABLE "speaking_attempts" ADD COLUMN "recording_sha256" varchar(64);
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "evaluation_claim_token" uuid;
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD COLUMN "evaluation_claim_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_recording_sha256_check" CHECK ("recording_sha256" IS NULL OR "recording_sha256" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
ALTER TABLE "speaking_attempts" ADD CONSTRAINT "speaking_evaluation_claim_pair_check" CHECK (("evaluation_claim_token" IS NULL) = ("evaluation_claim_expires_at" IS NULL));
