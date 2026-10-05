import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/validation/ids";
import { requireActiveUser } from "@/lib/auth/current-user";
import { completeAiSession, loadSessionSummaryInput, toAiSessionView } from "@/lib/data/speaking-ai-sessions";
import { buildSessionSummary } from "@/lib/speaking/ai-session-summary";
import { completeAiSessionSchema } from "@/lib/validation/speaking-ai";

/**
 * POST /api/speaking/ai/sessions/:id/complete — finish and summarise.
 *
 * The body accepts nothing (§42): the summary is computed server-side from the
 * evaluations already persisted against the session's own attempts. A client
 * cannot contribute a band, a criterion or a weakness to it, and no provider is
 * called during summarisation — so there is no path by which a model could
 * invent one of these numbers (§29).
 *
 * Idempotent (§46/§81): completing twice returns the same completed session and
 * the same summary. A double-press on "Finish" cannot corrupt anything.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = completeAiSessionSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await completeAiSession({ sessionId: id, userId: user.id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const summary = buildSessionSummary(await loadSessionSummaryInput(result.session));
  return NextResponse.json({
    ok: true,
    reused: result.reused,
    session: await toAiSessionView(result.session),
    summary,
  });
}
