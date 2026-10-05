import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/validation/ids";
import { requireActiveUser } from "@/lib/auth/current-user";
import { bindAttemptToSessionItem, toAiSessionView } from "@/lib/data/speaking-ai-sessions";
import { completeAiSessionItemSchema } from "@/lib/validation/speaking-ai";

/**
 * POST /api/speaking/ai/sessions/:id/items/:itemId/complete
 *
 * Binds an already-submitted answer to its question and advances the cursor —
 * the server half of "Send to RIWI" landing.
 *
 * Only an attempt id crosses this boundary. Everything else is re-derived in the
 * data layer (§43): that the session and the attempt both belong to this learner,
 * that the attempt answers THIS question's prompt, that it was really submitted,
 * and — when the question is already answered — that the new attempt is a genuine
 * retry of the bound one. "Try again" therefore creates a new attempt and rebinds
 * the item to it, while the earlier attempt stays in history untouched (§30).
 *
 * The cursor is the server's, never the client's: it moves by max() so a replayed
 * or out-of-order request cannot drag the learner backwards.
 *
 * Idempotent: replaying the same attempt id is a no-op reporting reused=true.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  if (!isUuid(id) || !isUuid(itemId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = completeAiSessionItemSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await bindAttemptToSessionItem({
    sessionId: id,
    itemId,
    attemptId: parsed.data.attemptId,
    userId: user.id,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    reused: result.reused,
    session: await toAiSessionView(result.session),
  });
}
