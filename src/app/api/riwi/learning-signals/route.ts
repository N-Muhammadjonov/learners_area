import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { RULES, accountKey, clientKey, consume } from "@/lib/http/rate-limit";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { readRiwiBoundedJson } from "@/lib/services/riwi/http";
import { createLearningSignal, LearningServiceError, listLearningSignals } from "@/lib/services/riwi/learning";
import { riwiEnabledForRole } from "@/lib/services/riwi/rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const submissionSchema = z.object({
  type: z.enum(["teacher_correction", "owner_correction", "manual_qa_finding"]),
  idempotencyKey: z.string().uuid(),
  targetUserId: z.string().uuid().optional(),
  candidateClaim: z.string().trim().min(1).max(1000),
  evidenceSummary: z.string().trim().min(1).max(800),
}).strict();

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
  });
}

export async function GET(request: NextRequest) {
  const ipLimit = consume(RULES.riwiLearningReadByIp, clientKey(request));
  if (!ipLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: ipLimit.retryAfterSeconds }, 429);
  let user;
  try { user = await requireActiveUser(); }
  catch { return response({ error: { code: "riwi_auth_unavailable" } }, 503); }
  if (!user) return response({ error: { code: "unauthorized" } }, 401);
  if (user.role !== "owner" || !riwiEnabledForRole(user.role)) return response({ error: { code: "forbidden" } }, 403);
  const accountLimit = consume(RULES.riwiLearningReadByAccount, accountKey(user.id));
  if (!accountLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: accountLimit.retryAfterSeconds }, 429);
  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (rawLimit !== null && !/^\d{1,3}$/.test(rawLimit)) return response({ error: { code: "riwi_request_invalid" } }, 400);
  try {
    const signals = await listLearningSignals(user, rawLimit === null ? 100 : Number(rawLimit));
    return response({ signals });
  } catch (error) {
    if (error instanceof LearningServiceError && error.code === "forbidden") return response({ error: { code: "forbidden" } }, 403);
    return response({ error: { code: "riwi_signal_unavailable" } }, 503);
  }
}

export async function POST(request: NextRequest) {
  const origin = checkRequestOrigin(request);
  if (!origin.allowed) return response({ error: { code: "riwi_request_invalid" } }, 403);

  const ipLimit = consume(RULES.riwiLearningByIp, clientKey(request));
  if (!ipLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: ipLimit.retryAfterSeconds }, 429);

  let user;
  try { user = await requireActiveUser(); }
  catch { return response({ error: { code: "riwi_auth_unavailable" } }, 503); }
  if (!user) return response({ error: { code: "unauthorized" } }, 401);
  if (!riwiEnabledForRole(user.role)) return response({ error: { code: "forbidden" } }, 403);

  const accountLimit = consume(RULES.riwiLearningByAccount, accountKey(user.id));
  if (!accountLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: accountLimit.retryAfterSeconds }, 429);
  const body = await readRiwiBoundedJson(request, 4096);
  if (!body.ok) return response({ error: { code: "riwi_request_invalid" } }, body.reason === "too_large" ? 413 : 400);
  const parsed = submissionSchema.safeParse(body.value);
  if (!parsed.success) return response({ error: { code: "riwi_request_invalid" } }, 400);

  if (user.role === "teacher") {
    if (parsed.data.type !== "teacher_correction" || !parsed.data.targetUserId) return response({ error: { code: "forbidden" } }, 403);
  } else if (user.role === "owner") {
    if (parsed.data.type === "teacher_correction") return response({ error: { code: "forbidden" } }, 403);
  } else {
    return response({ error: { code: "forbidden" } }, 403);
  }

  const sourceId = parsed.data.idempotencyKey;
  try {
    const signal = await createLearningSignal({
      actor: user,
      type: parsed.data.type,
      targetUserId: parsed.data.targetUserId ?? null,
      sourceId,
      scope: parsed.data.targetUserId ? "user" : "global",
      candidateClaim: parsed.data.candidateClaim,
      evidenceSummary: `${parsed.data.evidenceSummary}; source=staff_submission; correlation=${sourceId}; learner_artifact=omitted`,
    });
    return response({ ok: true, signalId: signal.id, correlationId: sourceId, state: signal.state }, 201);
  } catch (error) {
    if (!(error instanceof LearningServiceError)) return response({ error: { code: "riwi_signal_unavailable" } }, 503);
    const status = error.code === "forbidden" ? 403 : error.code === "invalid_input" ? 400
      : error.code === "not_found" ? 404 : error.code === "idempotency_conflict" ? 409 : 503;
    const code = error.code === "forbidden" ? "forbidden"
      : error.code === "invalid_input" ? "riwi_request_invalid"
        : error.code === "not_found" ? "not_found"
          : error.code === "idempotency_conflict" ? "riwi_idempotency_conflict" : "riwi_signal_unavailable";
    return response({ error: { code } }, status);
  }
}
