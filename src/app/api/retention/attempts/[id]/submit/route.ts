import { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { submitAttempt } from "@/lib/data/retention-attempts";
import { buildAttemptPayload } from "@/lib/retention/payload";
import { retentionJson, unauthenticated } from "@/lib/retention/http";
import { db } from "@/db/client";
import { timed } from "@/lib/observability/timing";

/**
 * POST /api/retention/attempts/:id/submit — finalize and score.
 *
 * The browser sends the recall text and nothing else. It never sends a score, a
 * matched claim, an awarded point, a deadline, a level or a version: the server
 * loads the IMMUTABLE version the attempt was assigned, evaluates the stored text
 * against it, persists the score and breakdown with the evaluator version, and
 * marks the attempt terminal in one transaction (§130, §132).
 *
 * Submitting twice returns the stored result unchanged; submitting after the
 * write deadline finalizes the latest persisted draft as `timed_out`.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return unauthenticated();
  const { id } = await context.params;

  const body = (await request.json().catch(() => null)) as { recallText?: unknown } | null;

  return retentionJson(() =>
    timed("retention.score", async () => {
      const result = await submitAttempt({
        attemptId: id,
        userId: user.id,
        recallText: typeof body?.recallText === "string" ? body.recallText : undefined,
      });
      const payload = await buildAttemptPayload(result.attempt, new Date(), db);
      return { idempotent: result.idempotent, ...payload };
    })
  );
}
