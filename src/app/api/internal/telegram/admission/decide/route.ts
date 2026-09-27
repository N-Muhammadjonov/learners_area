import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { decideAccessFromTelegram } from "@/lib/telegram/admission-bridge";
import { actorError, asRecord, clipText, readJson } from "@/lib/telegram/http";
import { findAccessRequestById } from "@/lib/data/admission";
import { isUuid } from "@/lib/validation/ids";

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  const body = asRecord(await readJson(req));
  const decision = body?.decision === "approve" || body?.decision === "reject" ? body.decision : null;
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  if (!decision || !isUuid(requestId)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const actor = await requireBotPermission(body?.actorTelegramId, "ADMISSIONS", { requireAuditUser: true });
  if (!actor.ok) return actorError(actor.error);

  const existing = await findAccessRequestById(requestId);
  const targetUserId = existing?.userId ?? requestId;
  if (actor.actor.linkedUserId && actor.actor.linkedUserId === targetUserId) {
    return NextResponse.json({ error: "self_approval" }, { status: 403 });
  }
  const applicant = isUuid(targetUserId)
    ? await db.query.users.findFirst({ where: eq(users.id, targetUserId), columns: { telegramId: true } })
    : null;
  if (applicant?.telegramId && applicant.telegramId === actor.actor.telegramUserId) {
    return NextResponse.json({ error: "self_approval" }, { status: 403 });
  }

  const result = await decideAccessFromTelegram({
    requestId,
    actorUserId: actor.actor.auditUserId!,
    actorTelegramId: actor.actor.telegramUserId,
    decision,
    note: clipText(body?.note, 500),
    applicantTelegramId: applicant?.telegramId ?? null,
  });

  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : result.error === "self_approval" ? 403 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ success: true, status: result.status, userId: result.userId });
}
