ALTER TABLE "riwi_provider_experiments" ADD COLUMN "idempotency_key" varchar(80);--> statement-breakpoint
UPDATE "riwi_provider_experiments" SET "idempotency_key" = 'legacy-' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "riwi_provider_experiments" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_provider_experiments_actor_idempotency_uidx" ON "riwi_provider_experiments" USING btree ("actor_user_id","idempotency_key");