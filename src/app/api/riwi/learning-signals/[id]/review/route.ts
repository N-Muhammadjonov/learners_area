import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { RULES, accountKey, clientKey, consume } from "@/lib/http/rate-limit";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { LearningServiceError, reviewLearningSignal } from "@/lib/services/riwi/learning";
import { riwiEnabledForRole } from "@/lib/services/riwi/rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const reviewSchema = z.object({
  decision: z.enum(["approve", "reject", "request_changes"]),
  reason: z.string().trim().min(1).max(1000),
  regressionFixtureId: z.string().trim().min(1).max(120).nullable().optional(),
}).strict();

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const origin = checkRequestOrigin(request);
  if (!origin.allowed) return response({ error: { code: "riwi_request_invalid" } }, 403);
  const ipLimit = consume(RULES.riwiLearningByIp, clientKey(request));
  if (!ipLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: ipLimit.retryAfterSeconds }, 429);

  let user;
  try { user = await requireActiveUser(); }
  catch { return response({ error: { code: "riwi_auth_unavailable" } }, 503); }
  if (!user) return response({ error: { code: "unauthorized" } }, 401);
  if (user.role !== "owner" || !riwiEnabledForRole(user.role)) return response({ error: { code: "forbidden" } }, 403);
  const accountLimit = consume(RULES.riwiLearningByAccount, accountKey(user.id));
  if (!accountLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: accountLimit.retryAfterSeconds }, 429);

  const body = await readRiwiBoundedJson(request, 2048);
  if (!body.ok) return response({ error: { code: "riwi_request_invalid" } }, body.reason === "too_large" ? 413 : 400);
  const parsed = reviewSchema.safeParse(body.value);
  if (!parsed.success) return response({ error: { code: "riwi_request_invalid" } }, 400);
  const { id } = await context.params;
  try {
    const review = await reviewLearningSignal({ actor: user, signalId: id, ...parsed.data });
    return response({ ok: true, ...review });
  } catch (error) {
    if (!(error instanceof LearningServiceError)) return response({ error: { code: "riwi_review_unavailable" } }, 503);
    const status = error.code === "forbidden" ? 403
      : error.code === "invalid_input" ? 400
        : error.code === "not_found" ? 404
          : error.code === "invalid_state" || error.code === "idempotency_conflict" ? 409
            : error.code === "regression_required" ? 422 : 503;
    const code = error.code === "forbidden" ? "forbidden"
      : error.code === "invalid_input" ? "riwi_request_invalid"
        : error.code === "not_found" ? "not_found"
          : error.code === "invalid_state" ? "riwi_learning_state_conflict"
            : error.code === "regression_required" ? "riwi_regression_required"
              : error.code === "idempotency_conflict" ? "riwi_idempotency_conflict" : "riwi_review_unavailable";
    return response({ error: { code } }, status);
  }
}
