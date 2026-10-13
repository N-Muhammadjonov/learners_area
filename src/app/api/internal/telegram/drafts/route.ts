import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { claimFlowDraft, createFlowDraft, readFlowDraft, updateFlowDraft } from "@/lib/telegram/flow-drafts";
import { asRecord, readJson } from "@/lib/telegram/http";

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  const action = body?.action;
  const actorTelegramId = typeof body?.actorTelegramId === "string" ? body.actorTelegramId : "";
  if (action === "create") {
    const result = await createFlowDraft({
      actorTelegramId,
      kind: typeof body?.kind === "string" ? body.kind : "",
      payload: asRecord(body?.payload) ?? {},
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  }
  if (action === "update") {
    const result = await updateFlowDraft({
      id: typeof body?.id === "string" ? body.id : "",
      actorTelegramId,
      payload: asRecord(body?.payload) ?? {},
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json(result);
  }
  if (action === "read") {
    const result = await readFlowDraft({
      id: typeof body?.id === "string" ? body.id : "",
      actorTelegramId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json(result);
  }
  if (action === "claim") {
    const result = await claimFlowDraft({
      id: typeof body?.id === "string" ? body.id : "",
      actorTelegramId,
      kind: typeof body?.kind === "string" ? body.kind : undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "invalid_input" }, { status: 400 });
}
