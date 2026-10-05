import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { speakingAiSessionItems, speakingAiSessions, speakingPrompts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listActivePrompts } from "@/lib/data/speaking-practice";
import { AI_MODES, buildAiSessionPlan } from "@/lib/speaking/ai-session";

const createSchema = z.object({ mode: z.enum(AI_MODES as ["full", "part1", "part2", "part3"]) }).strict();

/** Create and persist the randomized plan once. Refreshes read these rows; they never reshuffle. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const prompts = await listActivePrompts();
  const recent = await db.select({ promptId: speakingAiSessionItems.promptId })
    .from(speakingAiSessionItems)
    .innerJoin(speakingAiSessions, eq(speakingAiSessionItems.sessionId, speakingAiSessions.id))
    .where(eq(speakingAiSessions.userId, user.id))
    .orderBy(desc(speakingAiSessions.createdAt))
    .limit(80);
  const seed = crypto.randomUUID();
  const plan = buildAiSessionPlan(prompts, parsed.data.mode, { seed, recentPromptIds: recent.map((row) => row.promptId) });
  if (plan.items.length === 0) return NextResponse.json({ error: "no_questions" }, { status: 409 });

  const result = await db.transaction(async (tx) => {
    const [session] = await tx.insert(speakingAiSessions).values({
      userId: user.id,
      mode: parsed.data.mode,
      sessionSeed: seed,
      planVersion: plan.version,
      limitations: plan.limitations,
    }).returning();
    if (!session) throw new Error("session_create_failed");
    const items = await tx.insert(speakingAiSessionItems).values(plan.items.map((item) => ({
      sessionId: session.id,
      ordinal: item.ordinal,
      promptId: item.prompt.id,
      part: item.prompt.part as "part1" | "part2" | "part3" | "general",
      topicKey: item.topicKey,
      topicPosition: item.topicPosition,
      questionPosition: item.questionPosition,
    }))).returning();
    return { session, items };
  });

  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  return NextResponse.json({ ok: true, session: result.session, items: result.items.map((item) => ({ ...item, prompt: byId.get(item.promptId) })) });
}

/** Resume the most recent active owned session without creating or randomizing anything. */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const session = await db.query.speakingAiSessions.findFirst({
    where: and(eq(speakingAiSessions.userId, user.id), eq(speakingAiSessions.status, "active")),
    orderBy: [desc(speakingAiSessions.createdAt)],
  });
  if (!session) return NextResponse.json({ ok: true, session: null, items: [] });
  const items = await db.select().from(speakingAiSessionItems)
    .where(eq(speakingAiSessionItems.sessionId, session.id)).orderBy(speakingAiSessionItems.ordinal);
  const promptIds = items.map((item) => item.promptId);
  const prompts = promptIds.length ? await db.query.speakingPrompts.findMany({ where: inArray(speakingPrompts.id, promptIds) }) : [];
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  return NextResponse.json({ ok: true, session, items: items.map((item) => ({ ...item, prompt: byId.get(item.promptId) ?? null })) });
}
