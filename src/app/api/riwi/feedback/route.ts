import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { RULES, accountKey, clientKey, consume } from "@/lib/http/rate-limit";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { LearningServiceError, submitRiwiStudentFeedback } from "@/lib/services/riwi/learning";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { riwiEnabledForRole } from "@/lib/services/riwi/rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const feedbackSchema = z.object({
  correlationId: z.string().uuid(),
  rating: z.enum(["helpful", "not_helpful"]),
}).strict();

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
  });
}

export async function POST(request: NextRequest) {
  const origin = checkRequestOrigin(request);
  if (!origin.allowed) return response({ error: { code: "riwi_request_invalid" } }, 403);

  const ipLimit = consume(RULES.riwiFeedbackByIp, clientKey(request));
  if (!ipLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: ipLimit.retryAfterSeconds }, 429);

  let user;
  try { user = await requireActiveUser(); }
  catch { return response({ error: { code: "riwi_auth_unavailable" } }, 503); }
  if (!user) return response({ error: { code: "unauthorized" } }, 401);
  if (user.role !== "student" || !riwiEnabledForRole(user.role)) return response({ error: { code: "forbidden" } }, 403);

  const accountLimit = consume(RULES.riwiFeedbackByAccount, accountKey(user.id));
  if (!accountLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: accountLimit.retryAfterSeconds }, 429);

  const body = await readRiwiBoundedJson(request, 1024);
  if (!body.ok) return response({ error: { code: "riwi_request_invalid" } }, body.reason === "too_large" ? 413 : 400);
  const parsed = feedbackSchema.safeParse(body.value);
  if (!parsed.success) return response({ error: { code: "riwi_request_invalid" } }, 400);

  try {
    const result = await submitRiwiStudentFeedback({ actor: user, ...parsed.data });
    return response({ ok: result.recorded });
  } catch (error) {
    if (!(error instanceof LearningServiceError)) return response({ error: { code: "riwi_feedback_unavailable" } }, 503);
    const status = error.code === "forbidden" ? 403
      : error.code === "invalid_input" ? 400
        : error.code === "not_found" ? 404 : error.code === "idempotency_conflict" ? 409 : 503;
    const code = error.code === "forbidden" ? "forbidden"
      : error.code === "invalid_input" ? "riwi_request_invalid"
        : error.code === "not_found" ? "not_found"
          : error.code === "idempotency_conflict" ? "riwi_idempotency_conflict" : "riwi_feedback_unavailable";
    return response({ error: { code } }, status);
  }
}
