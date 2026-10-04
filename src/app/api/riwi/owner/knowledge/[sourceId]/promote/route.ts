import { NextRequest } from "next/server";
import { z } from "zod";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES } from "@/lib/http/rate-limit";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { KnowledgeServiceError, promoteKnowledgeSource } from "@/lib/services/riwi/knowledge";
import { enforceRiwiOwnerRate, knowledgeErrorResponse, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const schema = z.object({
  regressionFixtureId: z.literal("retrieval-active-scope-only-v1"),
  expectedVersion: z.number().int().positive(),
  supersedesSourceId: z.string().uuid().optional(),
  expectedSupersedesVersion: z.number().int().positive().optional(),
  reason: z.string().trim().max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.supersedesSourceId && value.expectedSupersedesVersion === undefined) {
    context.addIssue({ code: "custom", path: ["expectedSupersedesVersion"], message: "Required with supersedesSourceId" });
  }
  if (!value.supersedesSourceId && value.expectedSupersedesVersion !== undefined) {
    context.addIssue({ code: "custom", path: ["expectedSupersedesVersion"], message: "Only valid with supersedesSourceId" });
  }
});

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
    const result = await promoteKnowledgeSource({
      actor: access.user,
      sourceId,
      regressionFixtureId: parsed.data.regressionFixtureId,
      supersedesSourceId: parsed.data.supersedesSourceId,
      expectedVersion: parsed.data.expectedVersion,
      expectedSupersedesVersion: parsed.data.expectedSupersedesVersion,
      reason: parsed.data.reason,
    });
    return ownerJson({ ok: true, sourceId: result.id, state: result.state, version: result.version,
      supersedesSourceId: parsed.data.supersedesSourceId ?? null,
      regressionFixtureId: result.regressionFixtureId, regressionEvidenceHash: result.regressionEvidenceHash });
  } catch (error) {
    if (error instanceof KnowledgeServiceError) return knowledgeErrorResponse(error);
    return ownerJson({ error: { code: "riwi_knowledge_unavailable" } }, 503);
  }
}
