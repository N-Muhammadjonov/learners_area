import { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { findAttemptForUser } from "@/lib/data/retention-attempts";
import { buildAttemptPayload } from "@/lib/retention/payload";
import { retentionJson, unauthenticated } from "@/lib/retention/http";
import { db } from "@/db/client";

/**
 * GET /api/retention/attempts/:id — the learner's own attempt, in its own phase.
 *
 * Ownership is part of the query, so another learner's id is answered as "not
 * found" rather than as somebody else's attempt. The phase decides the shape:
 * reading returns the source, recall returns the draft and no source, terminal
 * returns the stored result. Nothing here recalculates a score.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return unauthenticated();
  const { id } = await context.params;

  return retentionJson(async () => {
    const attempt = await findAttemptForUser({ attemptId: id, userId: user.id });
    return buildAttemptPayload(attempt, new Date(), db);
  });
}
