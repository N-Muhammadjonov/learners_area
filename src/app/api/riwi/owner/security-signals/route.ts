import { NextRequest } from "next/server";
import { z } from "zod";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { RULES } from "@/lib/http/rate-limit";
import { enforceRiwiOwnerRate, ownerJson, requireRiwiOwner } from "@/lib/services/riwi/owner-route";
import { listSecuritySignals, previewSecuritySignal, reviewSecuritySignal } from "@/lib/services/riwi/security-learning";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const reviewSchema = z.object({
  signalId: z.string().uuid(),
  decision: z.enum(["preview_regression", "reject", "developer_action_required", "approve_regression"]),
  regressionFixtureId: z.string().trim().min(1).max(120).optional(),
  regressionEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "approve_regression" && (!value.regressionFixtureId || !value.regressionEvidenceHash)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "regression evidence required" });
  }
});

export async function GET(request: NextRequest) {
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, { account: RULES.riwiGovernanceReadByAccount, ip: RULES.riwiGovernanceReadByIp });
  if (limited) return limited;
  try {
    const signals = await listSecuritySignals({ id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus });
    return ownerJson({ ok: true, signals });
  } catch { return ownerJson({ error: { code: "riwi_security_signals_unavailable" } }, 503); }
}

export async function POST(request: NextRequest) {
  if (!checkRequestOrigin(request).allowed) return ownerJson({ error: { code: "riwi_request_invalid" } }, 403);
  const access = await requireRiwiOwner();
  if (!access.ok) return access.response;
  const limited = enforceRiwiOwnerRate(request, access.user, { account: RULES.riwiGovernanceReadByAccount, ip: RULES.riwiGovernanceReadByIp });
  if (limited) return limited;
  const body = await readRiwiBoundedJson(request, 4096);
  if (!body.ok) return ownerJson({ error: { code: "riwi_request_invalid" } }, body.reason === "too_large" ? 413 : 400);
  const parsed = reviewSchema.safeParse(body.value);
  if (!parsed.success) return ownerJson({ error: { code: "riwi_request_invalid" } }, 400);
  try {
    const actor = { id: access.user.id, role: access.user.role, accountStatus: access.user.accountStatus };
    const result = parsed.data.decision === "preview_regression"
      ? await previewSecuritySignal(actor, parsed.data.signalId)
      : await reviewSecuritySignal({ actor, ...parsed.data, decision: parsed.data.decision });
    return ownerJson({ ok: true, result });
  } catch (error) {
    return ownerJson({ error: { code: error instanceof Error && error.message === "stale_or_not_found" ? "riwi_action_stale" : "riwi_security_review_failed" } }, error instanceof Error && error.message === "stale_or_not_found" ? 409 : 503);
  }
}
