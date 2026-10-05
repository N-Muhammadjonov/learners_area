import { NextRequest } from "next/server";
import { z } from "zod";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { RULES } from "@/lib/http/rate-limit";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { enforceRiwiOwnerRate, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";
import { AssessmentPolicyError, ASSESSMENT_POLICY_STATES, createAssessmentPolicyCandidate, listAssessmentPolicyVersionPage } from "@/lib/services/coach/contracts/owner-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function policyErrorResponse(error: unknown) {
  if (!(error instanceof AssessmentPolicyError)) return ownerJson({ error: { code: "riwi_assessment_policy_unavailable" } }, 503);
  const status = error.code === "forbidden" ? 403
    : error.code === "not_found" ? 404
      : error.code === "invalid_input" ? 400
        : error.code === "unsupported_instruction" || error.code === "regression_failed" ? 422
          : error.code === "invalid_state" || error.code === "regression_required" ? 409 : 503;
  return ownerJson({ error: { code: `riwi_assessment_policy_${error.code}` } }, status);
}

const createSchema = z.object({ message: z.string().trim().min(8).max(2000) }).strict();

export async function GET(request: NextRequest) {
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiGovernanceReadByAccount, ip: RULES.riwiGovernanceReadByIp,
  });
  if (limited) return limited;
  const limits = request.nextUrl.searchParams.getAll("limit");
  const cursors = request.nextUrl.searchParams.getAll("cursor");
  const states = request.nextUrl.searchParams.getAll("state");
  if (limits.length > 1 || cursors.length > 1 || states.length > 1
    || (limits[0] !== undefined && !/^\d{1,3}$/.test(limits[0]))
    || (states[0] !== undefined && !(ASSESSMENT_POLICY_STATES as readonly string[]).includes(states[0]))) {
    return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  }
  try {
    // Cursor validation is bound to this active owner and the selected state filter in the service.
    const actor = { id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus };
    const page = await listAssessmentPolicyVersionPage(actor, { limit: limits[0] === undefined ? undefined : Number(limits[0]), cursor: cursors[0], state: states[0] as typeof ASSESSMENT_POLICY_STATES[number] | undefined });
    return ownerJson({ ok: true, ...page });
  } catch (error) {
    return policyErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const origin = checkRequestOrigin(request);
  if (!origin.allowed) return ownerJson({ error: { code: "riwi_request_invalid" } }, 403);
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, {
    account: RULES.riwiAssessmentPolicyWriteByAccount, ip: RULES.riwiAssessmentPolicyWriteByIp,
  });
  if (limited) return limited;
  const body = await readRiwiBoundedJson(request, 8192);
  if (!body.ok) return ownerJson({ error: { code: "riwi_request_invalid" } }, body.reason === "too_large" ? 413 : 400);
  const parsed = createSchema.safeParse(body.value);
  if (!parsed.success) return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  try {
    const result = await createAssessmentPolicyCandidate(access.user, parsed.data.message);
    return ownerJson({ ok: true, replay: result.replay, candidate: result.candidate }, result.replay ? 200 : 201);
  } catch (error) {
    return policyErrorResponse(error);
  }
}
