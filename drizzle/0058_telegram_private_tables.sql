-- Bot data is private. Only the trusted website database service owns access.
-- No anonymous/authenticated PostgREST policies are created.
ALTER TABLE "telegram_bot_admins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_broadcast_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_broadcasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_login_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_support_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_support_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_bot_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_deletion_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_direct_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_processed_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_flow_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ownership_transfer_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_owner_handovers" ENABLE ROW LEVEL SECURITY;
