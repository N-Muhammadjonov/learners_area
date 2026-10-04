DROP INDEX "riwi_provider_experiments_actor_created_idx";--> statement-breakpoint
CREATE INDEX "audit_log_created_id_idx" ON "audit_log" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "riwi_knowledge_sources_history_idx" ON "riwi_knowledge_sources" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "riwi_learning_signals_history_idx" ON "riwi_learning_signals" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "riwi_provider_experiments_actor_created_idx" ON "riwi_provider_experiments" USING btree ("actor_user_id","created_at","id");