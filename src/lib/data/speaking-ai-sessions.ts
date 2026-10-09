import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAiSessionItems, speakingAiSessions, speakingAttempts, speakingPrompts } from "@/db/schema";
import { listActivePrompts } from "./speaking-practice";
import { buildAiSessionPlan, type AiMode } from "@/lib/speaking/ai-session";

/** Persist canonical ids once; reads/resume never reconstruct or reshuffle a plan. */
export async function createSpeakingAiSession(database: typeof db, userId: string, mode: AiMode, seed = crypto.randomUUID()) {
  const prompts = await listActivePrompts(database);
  const recent = await database.select({ promptId: speakingAiSessionItems.promptId }).from(speakingAiSessionItems)
    .innerJoin(speakingAiSessions, eq(speakingAiSessionItems.sessionId, speakingAiSessions.id))
    .where(eq(speakingAiSessions.userId, userId)).orderBy(desc(speakingAiSessions.createdAt), speakingAiSessionItems.ordinal).limit(80);
  const plan = buildAiSessionPlan(prompts, mode, { seed, recentPromptIds: recent.map(row => row.promptId) });
  if (!plan.items.length) return null;
  const result = await database.transaction(async tx => {
    const [session] = await tx.insert(speakingAiSessions).values({ userId, mode, sessionSeed: seed, planVersion: plan.version, limitations: plan.limitations }).returning();
    if (!session) throw new Error("session_create_failed");
    const items = await tx.insert(speakingAiSessionItems).values(plan.items.map(item => ({
      sessionId: session.id, ordinal: item.ordinal, promptId: item.prompt.id,
      part: item.prompt.part as "part1" | "part2" | "part3" | "general",
      topicKey: item.topicKey, topicPosition: item.topicPosition, questionPosition: item.questionPosition,
    }))).returning();
    return { session, items };
  });
  const byId = new Map(prompts.map(prompt => [prompt.id, prompt]));
  return { session: result.session, items: result.items.sort((a, b) => a.ordinal - b.ordinal).map(item => ({ ...item, prompt: byId.get(item.promptId) ?? null })) };
}

export async function readSpeakingAiSession(database: typeof db, userId: string, id?: string) {
  const session = await database.query.speakingAiSessions.findFirst({
    where: and(eq(speakingAiSessions.userId, userId), id ? eq(speakingAiSessions.id, id) : eq(speakingAiSessions.status, "active")),
    orderBy: [desc(speakingAiSessions.createdAt), desc(speakingAiSessions.id)],
  });
  if (!session) return null;
  const items = await database.select().from(speakingAiSessionItems).where(eq(speakingAiSessionItems.sessionId, session.id)).orderBy(speakingAiSessionItems.ordinal);
  const ids = items.map(item => item.promptId);
  const prompts = ids.length ? await database.query.speakingPrompts.findMany({ where: inArray(speakingPrompts.id, ids) }) : [];
  const byId = new Map(prompts.map(prompt => [prompt.id, prompt]));
  return { session, items: items.map(item => ({ ...item, prompt: byId.get(item.promptId) ?? null })) };
}

type Completion = { action: "answered"; attemptId: string } | { action: "skipped" };
export async function completeSpeakingAiItem(database: typeof db, userId: string, id: string, itemId: string, body: Completion) {
  return database.transaction(async tx => {
    // One row lock serializes position checks and item/session advancement together.
    const [session] = await tx.select().from(speakingAiSessions).where(and(eq(speakingAiSessions.id, id), eq(speakingAiSessions.userId, userId))).for("update");
    if (!session) return { ok: false as const, error: "not_found", status: 404 };
    const item = await tx.query.speakingAiSessionItems.findFirst({ where: and(eq(speakingAiSessionItems.id, itemId), eq(speakingAiSessionItems.sessionId, id)) });
    if (!item) return { ok: false as const, error: "not_found", status: 404 };
    const attemptId = body.action === "answered" ? body.attemptId : null;
    if (item.status !== "pending") {
      return item.status === body.action && item.attemptId === attemptId
        ? { ok: true as const, item, session, reused: true }
        : { ok: false as const, error: "item_already_completed", status: 409 };
    }
    if (session.status !== "active") return { ok: false as const, error: "session_not_active", status: 409 };
    if (item.ordinal !== session.currentItemIndex + 1) return { ok: false as const, error: "stale_session_position", status: 409 };
    if (body.action === "answered") {
      const attempt = await tx.query.speakingAttempts.findFirst({ where: and(eq(speakingAttempts.id, body.attemptId), eq(speakingAttempts.userId, userId)) });
      if (!attempt || attempt.evaluationClaimToken || attempt.status === "recording" || attempt.promptId !== item.promptId || attempt.aiSessionId !== id || attempt.aiSessionItemId !== itemId) {
        return { ok: false as const, error: "invalid_attempt", status: 409 };
      }
      const latest = await tx.query.speakingAttempts.findFirst({ where: and(eq(speakingAttempts.userId, userId), eq(speakingAttempts.aiSessionItemId, itemId)), orderBy: [desc(speakingAttempts.createdAt), desc(speakingAttempts.id)] });
      if (latest?.id !== attempt.id) return { ok: false as const, error: "stale_answer_generation", status: 409 };
    }
    const [updatedItem] = await tx.update(speakingAiSessionItems).set({ status: body.action, attemptId }).where(eq(speakingAiSessionItems.id, item.id)).returning();
    const total = await tx.$count(speakingAiSessionItems, eq(speakingAiSessionItems.sessionId, id));
    const [updatedSession] = await tx.update(speakingAiSessions).set({ currentItemIndex: item.ordinal, ...(item.ordinal >= total ? { status: "completed", completedAt: new Date() } : {}) }).where(eq(speakingAiSessions.id, id)).returning();
    if (!updatedItem || !updatedSession) throw new Error("session_advance_failed");
    return { ok: true as const, item: updatedItem, session: updatedSession, reused: false };
  });
}
