import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";

/** Readiness for the bot process. Liveness stays on the bot's own /health. */
export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 16 || !process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_BOT_USERNAME) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  try {
    // Do not report ready when the connection works but the bot schema is absent.
    await db.execute(sql`select token_hash, browser_nonce_hash, purpose from telegram_login_intents limit 0`);
    await db.execute(sql`select phone_number, phone_verified_at, linked_user_id from telegram_contacts limit 0`);
    await db.execute(sql`select permissions, is_active from telegram_bot_admins limit 0`);
    await db.execute(sql`select key, value from telegram_bot_settings limit 0`);
    await db.execute(sql`select status from ownership_transfer_challenges limit 0`);
    await db.execute(sql`select status from telegram_owner_handovers limit 0`);
    await db.execute(sql`select payload from telegram_flow_drafts limit 0`);
    const privacy = await db.execute(sql`select count(*)::int as count from pg_class where relkind = 'r' and relrowsecurity and relnamespace = 'public'::regnamespace and relname in ('telegram_bot_admins','telegram_broadcast_deliveries','telegram_broadcasts','telegram_contacts','telegram_login_intents','telegram_support_messages','telegram_support_threads','telegram_bot_settings','telegram_deletion_intents','telegram_direct_messages','telegram_notifications','telegram_processed_updates','telegram_flow_drafts','ownership_transfer_challenges','telegram_owner_handovers')`);
    if (Number(privacy.rows[0]?.count) !== 15) return NextResponse.json({ ok: false }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
