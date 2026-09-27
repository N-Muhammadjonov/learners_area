import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { asRecord, readJson } from "@/lib/telegram/http";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { claimNotificationBatch, readNotificationPrefs, reportNotificationResults, writeNotificationPrefs } from "@/lib/telegram/notifications";

export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const actor = req.nextUrl.searchParams.get("actorTelegramId") ?? "";
  if (!isTelegramUserId(actor)) return NextResponse.json({ error: "invalid_actor" }, { status: 400 });
  return NextResponse.json(await readNotificationPrefs(actor));
}

export async function PUT(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  const actor = typeof body?.actorTelegramId === "string" ? body.actorTelegramId : "";
  if (!isTelegramUserId(actor)) return NextResponse.json({ error: "invalid_actor" }, { status: 400 });
  const locale = body?.locale === "en" || body?.locale === "uz" ? body.locale : undefined;
  const prefs = await writeNotificationPrefs({
    telegramUserId: actor,
    announcements: typeof body?.announcements === "boolean" ? body.announcements : undefined,
    reminders: typeof body?.reminders === "boolean" ? body.reminders : undefined,
    locale,
  });
  return NextResponse.json(prefs);
}

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  if (Array.isArray(body?.results)) {
    const results = body.results.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const status = row.status === "sent" || row.status === "failed" || row.status === "blocked" ? row.status : null;
      if (typeof row.id !== "string" || !status) return [];
      return [{
        id: row.id,
        status: status as "sent" | "failed" | "blocked",
        error: typeof row.error === "string" ? row.error : null,
        retryAfterSeconds: typeof row.retryAfterSeconds === "number" ? row.retryAfterSeconds : null,
      }];
    });
    return NextResponse.json(await reportNotificationResults(results));
  }
  return NextResponse.json({ notices: await claimNotificationBatch(typeof body?.limit === "number" ? body.limit : 15) });
}
