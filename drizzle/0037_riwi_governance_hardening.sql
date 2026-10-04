ALTER TABLE "riwi_learning_reviews" DROP CONSTRAINT "riwi_learning_reviews_approve_regression_check";--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "regression_fixture_id" varchar(120);--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "regression_evidence_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD COLUMN "regression_passed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" ADD COLUMN "regression_evidence_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" ADD COLUMN "regression_passed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "riwi_knowledge_sources_type_checksum_uidx" ON "riwi_knowledge_sources" USING btree ("source_type","checksum");--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_scope_consistency_check" CHECK ((
    ("riwi_knowledge_sources"."scope" = 'global' and "riwi_knowledge_sources"."scope_role" is null and "riwi_knowledge_sources"."scope_user_id" is null) or
    ("riwi_knowledge_sources"."scope" = 'role' and "riwi_knowledge_sources"."scope_role" is not null and "riwi_knowledge_sources"."scope_user_id" is null) or
    ("riwi_knowledge_sources"."scope" = 'user' and "riwi_knowledge_sources"."scope_role" is null and "riwi_knowledge_sources"."scope_user_id" is not null)
  ));--> statement-breakpoint
ALTER TABLE "riwi_knowledge_sources" ADD CONSTRAINT "riwi_knowledge_sources_active_regression_check" CHECK ("riwi_knowledge_sources"."state" <> 'active' or (
    "riwi_knowledge_sources"."regression_fixture_id" is not null and "riwi_knowledge_sources"."regression_evidence_hash" is not null and "riwi_knowledge_sources"."regression_passed_at" is not null
  ));--> statement-breakpoint
ALTER TABLE "riwi_learning_reviews" ADD CONSTRAINT "riwi_learning_reviews_approve_regression_check" CHECK ("riwi_learning_reviews"."decision" <> 'approve' or (
    "riwi_learning_reviews"."regression_fixture_id" is not null and "riwi_learning_reviews"."regression_evidence_hash" is not null and "riwi_learning_reviews"."regression_passed_at" is not null
  ));--> statement-breakpoint
ALTER TABLE "riwi_learning_signals" ADD CONSTRAINT "riwi_learning_signals_scope_target_check" CHECK ((
    ("riwi_learning_signals"."scope" = 'global' and "riwi_learning_signals"."target_user_id" is null) or
    ("riwi_learning_signals"."scope" = 'user' and "riwi_learning_signals"."target_user_id" is not null)
  ));--> statement-breakpoint
ALTER TABLE "riwi_usage_metrics" ADD CONSTRAINT "riwi_usage_metrics_cost_check" CHECK ("riwi_usage_metrics"."estimated_cost_micros" is null or "riwi_usage_metrics"."estimated_cost_micros" >= 0);