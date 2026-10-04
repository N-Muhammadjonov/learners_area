import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES, accountKey, consume } from "@/lib/http/rate-limit";
import { deleteRiwiConversation, getRiwiConversationTranscript, RiwiConversationError } from "@/lib/services/riwi/conversations";
import { recordRiwiAudit } from "@/lib/services/riwi/audit";
import { riwiEnabledForRole } from "@/lib/services/riwi/rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idSchema = z.string().uuid();
const transcriptSchema = z.object({
  ok: z.literal(true),
  conversationId: z.string().uuid(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]), content: z.string().max(6000), createdAt: z.string().datetime(),
    correlationId: z.string().uuid().nullable(),
    provenance: z.enum(["canonical_dictionary", "deterministic_learning_data", "deterministic_report", "external_provider", "policy_refusal", "unavailable"]).nullable(),
    provider: z.object({ id: z.string().max(60), model: z.string().max(120).nullable() }).strict().nullable(),
    citations: z.array(z.object({ source: z.string().max(120), version: z.number().int().positive().nullable() }).strict()).max(8),
  }).strict()).max(60),
}).strict();

function unavailable(status: number) {
  return NextResponse.json({ error: { code: "not_found" } }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return unavailable(401);
  if (!riwiEnabledForRole(user.role)) return unavailable(404);
  const limit = consume(RULES.riwiConversationRead, accountKey(user.id));
  if (!limit.ok) return NextResponse.json({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: limit.retryAfterSeconds }, {
    status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "private, no-store" },
  });
  if (!idSchema.safeParse(id).success) return unavailable(404);
  const correlationId = randomUUID();
  try {
    const messages = await getRiwiConversationTranscript({ actor: { id: user.id, role: user.role }, conversationId: id });
    await recordRiwiAudit({ actorUserId: user.id, action: "riwi.conversation.read", targetType: "riwi_conversation", targetId: id,
      metadata: { correlationId, role: user.role, resultCount: messages.length, status: "read" } });
    return NextResponse.json(transcriptSchema.parse({ ok: true, conversationId: id, messages }), {
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
    });
  } catch {
    return unavailable(404);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return unavailable(401);
  if (!riwiEnabledForRole(user.role)) return unavailable(404);
  const origin = checkRequestOrigin(_req);
  if (!origin.allowed) {
    await recordRiwiAudit({ actorUserId: user.id, action: "riwi.request.denied", targetType: "riwi_request",
      targetId: randomUUID(), metadata: { role: user.role, status: `origin_${origin.reason}` } }).catch(() => {});
    return unavailable(403);
  }
  const limit = consume(RULES.riwiChatByAccount, accountKey(user.id));
  if (!limit.ok) return NextResponse.json({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: limit.retryAfterSeconds }, {
    status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "private, no-store" },
  });
  if (!idSchema.safeParse(id).success) return unavailable(404);
  try {
    const result = await deleteRiwiConversation({ actor: { id: user.id, role: user.role }, conversationId: id, correlationId: randomUUID() });
    return NextResponse.json({ ok: result.deleted }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return error instanceof RiwiConversationError && error.code === "write_failed" ? unavailable(503) : unavailable(404);
  }
}
