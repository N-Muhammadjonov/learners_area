import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listActivePrompts } from "@/lib/data/speaking-practice";
import {
  createAiSession,
  listAiSessionsForUser,
  recentAnsweredPromptIds,
  toAiSessionView,
} from "@/lib/data/speaking-ai-sessions";
import { buildSessionPlan, randomSessionSeed } from "@/lib/speaking/ai-session-plan";
import { createAiSessionSchema, listAiSessionsQuerySchema } from "@/lib/validation/speaking-ai";

/**
 * POST /api/speaking/ai/sessions — start a Practice with AI session.
 *
 * The examiner plan is built HERE, server-side, from the canonical published
 * bank and persisted in the same request. The client supplies only a mode: it
 * cannot choose questions, supply a seed, or post a plan (§43), because
 * `createAiSessionSchema` is `.strict()` and the planner is not reachable from
 * the browser.
 *
 * Once written, the plan is the authority. A refresh re-reads these rows and
 * renders the same questions in the same order (§11) — nothing re-derives it.
 *
 * GET /api/speaking/ai/sessions — the caller's own sessions, newest first.
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createAiSessionSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const prompts = await listActivePrompts();
  // §33: recently answered questions are de-prioritised, never excluded. The
  // planner falls back to the whole pool when everything is recent, so a
  // diligent learner is handed a real session rather than an empty one.
  const recent = await recentAnsweredPromptIds(user.id);

  const plan = buildSessionPlan(prompts, {
    mode: parsed.data.mode,
    seed: randomSessionSeed(),
    recentPromptIds: recent,
  });

  if (plan.items.length === 0) {
    // Nothing published for this mode. Reported as a genuine shortfall: the bank
    // is never padded with invented questions to make a session look complete (§9).
    return NextResponse.json(
      { error: "no_questions_available", mode: parsed.data.mode, publishedQuestions: prompts.length },
      { status: 409 },
    );
  }

  const session = await createAiSession({ userId: user.id, mode: parsed.data.mode, plan });
  return NextResponse.json({ ok: true, session: await toAiSessionView(session) });
}

export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = listAiSessionsQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const sessions = await listAiSessionsForUser(user.id, parsed.data.limit ?? 20);
  return NextResponse.json({ ok: true, sessions });
}
