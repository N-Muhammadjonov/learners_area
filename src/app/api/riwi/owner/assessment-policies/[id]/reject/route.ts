import { NextRequest } from "next/server";
import { z } from "zod";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES } from "@/lib/http/rate-limit";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { enforceRiwiOwnerRate, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";
import { AssessmentPolicyError, rejectAssessmentPolicyCandidate } from "@/lib/services/coach/contracts/owner-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const schema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

function errorResponse(error: unknown) {
  if (!(error instanceof AssessmentPolicyError)) return ownerJson({ error: { code: "riwi_assessment_policy_unavailable" } }, 503);
  const status = error.code === "forbidden" ? 403 : error.code === "not_found" ? 404
    : error.code === "invalid_input" ? 400 : error.code === "invalid_state" ? 409 : 503;
  return ownerJson({ error: { code: `riwi_assessment_policy_${error.code}` } }, status);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const origin = checkRequestOrigin(request);
  if (!origin.allowed) return ownerJson({ error: { code: "riwi_request_invalid" } }, 403);
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiAssessmentPolicyWriteByAccount, ip: RULES.riwiAssessmentPolicyWriteByIp,
  });
  if (limited) return limited;
  const body = await readRiwiBoundedJson(request, 2048);
  if (!body.ok) return ownerJson({ error: { code: "riwi_request_invalid" } }, body.reason === "too_large" ? 413 : 400);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  try {
    const { id } = await context.params;
    return ownerJson({ ok: true, candidate: await rejectAssessmentPolicyCandidate(access.user, id, parsed.data.reason) });
  } catch (error) {
    return errorResponse(error);
  }
}
