-- Verified Telegram contact share. Must be applied only by an authorized migration operator.
ALTER TABLE "telegram_contacts" ADD COLUMN IF NOT EXISTS "phone_number" varchar(32);--> statement-breakpoint
ALTER TABLE "telegram_contacts" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;
