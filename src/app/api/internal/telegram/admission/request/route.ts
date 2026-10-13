import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requestAccessFromTelegram } from "@/lib/telegram/admission-bridge";
import { asRecord, clipText, readJson } from "@/lib/telegram/http";
import { enforce, RULES } from "@/lib/http/rate-limit";

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  const body = asRecord(await readJson(req));
  const telegramUserId = typeof body?.telegramUserId === "string" ? body.telegramUserId : "";
  const limited = enforce(RULES.admissionRequest, `tg:${telegramUserId || "unknown"}`);
  if (limited) return limited;

  const result = await requestAccessFromTelegram({
    telegramUserId,
    name: clipText(body?.name, 200) ?? "",
    message: clipText(body?.message, 500),
    username: clipText(body?.username, 120),
    chatId: clipText(body?.chatId, 64),
    languageCode: clipText(body?.languageCode, 10),
  });

  if (!result.ok) {
    const status =
      result.error === "invalid_actor" || result.error === "invalid_input" ? 400 :
      result.error === "phone_required" || result.error === "not_subscribed" ? 403 :
      result.error === "membership_unavailable" ? 503 :
      result.error === "not_requestable" ? 409 : 500;
    return NextResponse.json({
      error: result.error,
      ...("requiredChannels" in result ? { requiredChannels: result.requiredChannels } : {}),
    }, { status });
  }
  return NextResponse.json({
    success: true,
    status: result.status,
    requestId: result.requestId,
    userId: result.userId,
  });
}
