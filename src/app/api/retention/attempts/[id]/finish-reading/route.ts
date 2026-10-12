import { requireActiveUser } from "@/lib/auth/current-user";
import { finishReadingEarly } from "@/lib/data/retention-attempts";
import { buildAttemptPayload } from "@/lib/retention/payload";
import { retentionJson, unauthenticated } from "@/lib/retention/http";
import { db } from "@/db/client";

/**
 * POST /api/retention/attempts/:id/finish-reading — "I've finished" reading.
 *
 * No body is read: owner, phase and both deadlines come from the server row.
 * Repeating the call is safe and never extends the recall clock. The response
 * is the phase-aware payload, so the source text is absent once recall begins.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return unauthenticated();
  const { id } = await context.params;
  return retentionJson(async () => {
    const result = await finishReadingEarly({ attemptId: id, userId: user.id });
    const payload = await buildAttemptPayload(result.attempt, new Date(), db);
    return { idempotent: result.idempotent, ...payload };
  });
}
