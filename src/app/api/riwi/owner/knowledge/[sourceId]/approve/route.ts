import { NextRequest } from "next/server";
import { z } from "zod";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES } from "@/lib/http/rate-limit";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { approveKnowledgeCandidate, KnowledgeServiceError } from "@/lib/services/riwi/knowledge";
import { enforceRiwiOwnerRate, knowledgeErrorResponse, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const schema = z.object({ reason: z.string().trim().max(1000).optional() }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ sourceId: string }> }) {
  const origin = checkRequestOrigin(request);
  if (!origin.allowed) return ownerJson({ error: { code: "riwi_request_invalid" } }, 403);
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiKnowledgeWriteByAccount, ip: RULES.riwiKnowledgeWriteByIp,
  });
  if (limited) return limited;
  const body = await readRiwiBoundedJson(request, 8_192);
  if (!body.ok) return ownerJson({ error: { code: "riwi_request_invalid" } }, body.reason === "too_large" ? 413 : 400);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  try {
    const { sourceId } = await context.params;
    const result = await approveKnowledgeCandidate({
      actor: access.user, sourceId, reason: parsed.data.reason,
    });
    return ownerJson({ ok: true, sourceId: result.id, state: result.state, version: result.version });
  } catch (error) {
    if (error instanceof KnowledgeServiceError) return knowledgeErrorResponse(error);
    return ownerJson({ error: { code: "riwi_knowledge_unavailable" } }, 503);
  }
}
