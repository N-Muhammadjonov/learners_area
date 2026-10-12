import { NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { saveRecallDraft } from "@/lib/data/retention-attempts";
import { retentionJson, unauthenticated } from "@/lib/retention/http";

/**
 * PATCH /api/retention/attempts/:id/draft — autosave the recall text.
 *
 * The body carries an attempt id in the path and `{ recallText }` in the body,
 * and nothing else. The server derives the owner, the phase and the deadline from
 * its own rows: a browser cannot claim more time, cannot write to another
 * learner's attempt, and cannot save outside the recall window (§120, §129).
 *
 * The response is the truth the UI shows: "Saved" may only appear after this
 * answers, and a failure must surface as unsaved rather than as a silent lie.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return unauthenticated();
  const { id } = await context.params;

  const body = (await request.json().catch(() => null)) as { recallText?: unknown } | null;

  return retentionJson(async () => {
    const saved = await saveRecallDraft({
      attemptId: id,
      userId: user.id,
      recallText: body?.recallText ?? "",
    });
    return { ok: true, ...saved };
  });
}
