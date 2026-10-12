import { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { findAnyLiveAttempt, startOrResumeAttempt } from "@/lib/data/retention-attempts";
import { buildAttemptPayload } from "@/lib/retention/payload";
import { retentionJson, unauthenticated } from "@/lib/retention/http";
import { db } from "@/db/client";

/**
 * POST /api/retention/attempts — start or resume a Retention attempt.
 *
 * The ONLY accepted input is `{ level }`. A user id, a text id, a version id, a
 * cycle, a deadline or a score in the body is simply not read: the server derives
 * all of them from the authenticated session and the rotation state (§127, §193).
 *
 * Two simultaneous requests resolve to the SAME attempt (see
 * `startOrResumeAttempt`), so a double click cannot consume two texts.
 */
export async function POST(request: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return unauthenticated();

  const body = (await request.json().catch(() => ({}))) as { level?: unknown };

  return retentionJson(async () => {
    const result = await startOrResumeAttempt({ userId: user.id, level: body.level });
    const payload = await buildAttemptPayload(result.attempt, new Date(), db);
    return { outcome: result.outcome, ...payload };
  });
}

/**
 * GET /api/retention/attempts — the caller's own live attempt, or `{ active: null }`.
 *
 * Read-only authoritative recheck used after a start POST whose outcome is
 * unknown (timeout/network) and when the page is restored from the back/forward
 * cache. It never creates or changes an attempt (an expired one is finalized as
 * timed out, exactly as on page load).
 */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return unauthenticated();
  return retentionJson(async () => {
    const now = new Date();
    const attempt = await findAnyLiveAttempt({ userId: user.id, now });
    if (!attempt || (attempt.status !== "reading" && attempt.status !== "recall")) return { active: null };
    return { active: await buildAttemptPayload(attempt, now, db) };
  });
}
