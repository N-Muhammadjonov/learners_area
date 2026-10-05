import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/validation/ids";
import { requireActiveUser } from "@/lib/auth/current-user";
import { skipAiSessionItem, toAiSessionView } from "@/lib/data/speaking-ai-sessions";
import { skipAiSessionItemSchema } from "@/lib/validation/speaking-ai";

/**
 * POST /api/speaking/ai/sessions/:id/items/:itemId/skip
 *
 * Moves past a question without answering it.
 *
 * The body accepts nothing, which is the point: a skip must never be able to
 * carry an answer, a transcript or a band. Skipping is a first-class outcome —
 * the item keeps `attemptId = null`, so the summary reports the question as
 * unanswered rather than as a zero, and nothing is fabricated to fill the gap.
 *
 * Idempotent: a repeated skip leaves an already-skipped item alone and simply
 * re-advances the cursor, so a double-press is harmless.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  if (!isUuid(id) || !isUuid(itemId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = skipAiSessionItemSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await skipAiSessionItem({ sessionId: id, itemId, userId: user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, session: await toAiSessionView(result.session) });
}
