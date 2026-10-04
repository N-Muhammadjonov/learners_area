ALTER TABLE "riwi_learning_signals" DROP CONSTRAINT "riwi_learning_signals_scope_target_check";--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ALTER COLUMN "source_id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
UPDATE "riwi_learning_signals" SET "source_id" = gen_random_uuid() WHERE "source_id" IS NULL;--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_scope_target_check" CHECK ((
    ("riwi_learning_signals"."scope" = 'global' and "riwi_learning_signals"."target_user_id" is null) or
    "riwi_learning_signals"."scope" = 'user'
  ));