import { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listRetentionHistory } from "@/lib/data/retention-attempts";
import { retentionJson, unauthenticated } from "@/lib/retention/http";
import { db } from "@/db/client";
import { timed } from "@/lib/observability/timing";

/**
 * GET /api/retention/history?page=2 — the learner's own history, newest first.
 *
 * Bounded twice over: the page size has a hard ceiling, and the query is scoped
 * to the authenticated learner, so there is no "all learners" shape to ask for.
 */
export async function GET(request: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return unauthenticated();
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1") || 1;

  return retentionJson(() =>
    timed("retention.history", () => listRetentionHistory({ userId: user.id, page, pageSize: 10 }, db))
  );
}
