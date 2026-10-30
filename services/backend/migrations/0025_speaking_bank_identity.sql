ALTER TABLE "speaking_prompts" ADD COLUMN "external_id" varchar(40);--> statement-breakpoint
ALTER TABLE "speaking_prompts" ADD COLUMN "topic" varchar(200);--> statement-breakpoint
ALTER TABLE "speaking_prompts" ADD COLUMN "source_class" varchar(60);--> statement-breakpoint
ALTER TABLE "speaking_prompts" ADD COLUMN "available_in" jsonb DEFAULT '["practice_alone"]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "speaking_prompts_external_id_idx" ON "speaking_prompts" USING btree ("external_id") WHERE "speaking_prompts"."external_id" is not null;