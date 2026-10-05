import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { RULES, accountKey, clientKey, consume } from "@/lib/http/rate-limit";
import { LearningServiceError, listLearningCandidateForOwner, listLearningReviewPageForOwner } from "@/lib/services/riwi/learning";
import { RIWI_OWNER_HISTORY_PAGE_SIZE } from "@/lib/services/riwi/owner-history-cursor";
import { riwiEnabledForRole } from "@/lib/services/riwi/rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ipLimit = consume(RULES.riwiLearningReadByIp, clientKey(request));
  if (!ipLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: ipLimit.retryAfterSeconds }, 429);
  let user;
  try { user = await requireActiveUser(); }
  catch { return response({ error: { code: "riwi_auth_unavailable" } }, 503); }
  if (!user) return response({ error: { code: "unauthorized" } }, 401);
  if (user.role !== "owner" || !riwiEnabledForRole(user.role)) return response({ error: { code: "forbidden" } }, 403);
  const accountLimit = consume(RULES.riwiLearningReadByAccount, accountKey(user.id));
  if (!accountLimit.ok) return response({ error: { code: "riwi_rate_limited" }, retryAfterSeconds: accountLimit.retryAfterSeconds }, 429);

  const { id } = await context.params;
  const limits = request.nextUrl.searchParams.getAll("limit");
  const cursors = request.nextUrl.searchParams.getAll("cursor");
  if (limits.length > 1 || cursors.length > 1 || (limits[0] !== undefined && !/^\d{1,3}$/.test(limits[0]))) {
    return response({ error: { code: "riwi_request_invalid" } }, 400);
  }
  try {
    const signal = await listLearningCandidateForOwner(user, id);
    if (!signal) return response({ error: { code: "not_found" } }, 404);
    const reviewPage = await listLearningReviewPageForOwner(user, id, {
      limit: limits[0] === undefined ? RIWI_OWNER_HISTORY_PAGE_SIZE : Number(limits[0]),
      cursor: cursors[0],
    });
    return response({ signal, reviews: reviewPage.reviews, reviewsNextCursor: reviewPage.nextCursor });
  } catch (error) {
    if (!(error instanceof LearningServiceError)) return response({ error: { code: "riwi_signal_unavailable" } }, 503);
    const status = error.code === "forbidden" ? 403 : error.code === "invalid_input" ? 400 : error.code === "not_found" ? 404 : 503;
    const code = error.code === "forbidden" ? "forbidden" : error.code === "invalid_input" ? "riwi_request_invalid"
      : error.code === "not_found" ? "not_found" : "riwi_signal_unavailable";
    return response({ error: { code } }, status);
  }
}
