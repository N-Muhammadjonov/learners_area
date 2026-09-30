import { requireActiveUser } from "@/lib/auth/current-user";
import { getRetentionSummary } from "@/lib/data/retention-attempts";
import { retentionJson, unauthenticated } from "@/lib/retention/http";
import { db } from "@/db/client";

/**
 * GET /api/retention/summary — "My memory".
 *
 * Real numbers from real terminal attempts: completed count, best score, the mean
 * of the latest up to ten, and the same per level. Nothing is inferred from a
 * trend line, and a learner with fewer than ten results is told the count that
 * was actually averaged.
 */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return unauthenticated();
  return retentionJson(() => getRetentionSummary(user.id, db));
}
