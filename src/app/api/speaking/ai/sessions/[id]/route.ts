import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/validation/ids";
import { requireActiveUser } from "@/lib/auth/current-user";
import {
  findAiSessionForUser,
  loadSessionSummaryInput,
  toAiSessionView,
} from "@/lib/data/speaking-ai-sessions";
import { buildSessionSummary } from "@/lib/speaking/ai-session-summary";

/**
 * GET /api/speaking/ai/sessions/:id — the persisted plan, plus prompt text.
 *
 * This is what makes a refresh safe (§11): the response is read from the rows
 * written at creation, so the questions, their order, the topic clustering and
 * the cursor are exactly what the learner left. No re-shuffle, no re-derivation,
 * and no call to the planner.
 *
 * A summary is included only once the session is finished. Computing one for an
 * in-progress session would present a partial score as if it were a result.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Ownership is folded into the lookup: another learner's session is
  // indistinguishable from one that does not exist.
  const session = await findAiSessionForUser(id, user.id);
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const view = await toAiSessionView(session);
  const summary =
    session.status === "active" ? null : buildSessionSummary(await loadSessionSummaryInput(session));

  return NextResponse.json({ ok: true, session: view, summary });
}
