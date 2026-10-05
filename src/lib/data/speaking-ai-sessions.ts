import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAiSessionItems, speakingAiSessions, speakingAttempts, speakingPrompts } from "@/db/schema";
import { findEvaluationsForSources } from "@/lib/data/evaluations";
import { isSessionPlanMode, type SessionPlan, type SessionPlanMode } from "@/lib/speaking/ai-session-plan";
import { parsePart } from "@/lib/speaking/practice-browse";
import type { SessionSummaryInput } from "@/lib/speaking/ai-session-summary";

/**
 * Persistence for Practice with AI sessions (spec §11, §30, §42–§44).
 *
 * Three properties this module exists to guarantee:
 *
 *  1. THE PLAN IS IMMUTABLE. `speaking_ai_session_items` rows are written once,
 *     at creation, from the server-built plan. Nothing here re-derives ordinals,
 *     re-shuffles topics or re-reads the bank, so a page refresh renders the
 *     same questions in the same order (§11). There is no update path for
 *     ordinal/promptId/topic columns at all.
 *
 *  2. THE CURSOR ONLY MOVES ON A REAL LEARNER ACTION. `currentItemIndex`
 *     advances when an answer is bound or a question is skipped, and it uses a
 *     max() so a late or replayed request can never drag it backwards.
 *
 *  3. EVERY BINDING IS RE-AUTHORISED SERVER-SIDE. A client supplies only an
 *     attempt id; ownership, prompt match, submission state and retry lineage
 *     are all re-checked here (§43). Nothing about the evaluation, the
 *     transcript origin or the provider is accepted from the caller.
 */

export type AiSessionRow = typeof speakingAiSessions.$inferSelect;
export type AiSessionItemRow = typeof speakingAiSessionItems.$inferSelect;
export type AiSessionWithItems = AiSessionRow & { items: AiSessionItemRow[] };

type Database = typeof db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The prompt columns a session item renders.
 *
 * Read live from the canonical `speaking_prompts` row rather than copied into the
 * plan, so there is still exactly one question bank (§4) and a staff correction
 * to a prompt reaches an in-flight session instead of a stale duplicate.
 */
export type AiSessionPromptView = {
  id: string;
  part: string;
  topic: string | null;
  promptText: string;
  cueCard: string | null;
  prepSeconds: number;
  answerSeconds: number;
};

export type AiSessionItemView = AiSessionItemRow & { prompt: AiSessionPromptView | null };
export type AiSessionView = AiSessionRow & { items: AiSessionItemView[] };

export type AiSessionFailure = { ok: false; status: 404 | 403 | 409; error: string };

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

async function selectSessionWithItems(sessionId: string): Promise<AiSessionWithItems | null> {
  const [session] = await db.select().from(speakingAiSessions).where(eq(speakingAiSessions.id, sessionId)).limit(1);
  if (!session) return null;
  const items = await db
    .select()
    .from(speakingAiSessionItems)
    .where(eq(speakingAiSessionItems.sessionId, sessionId))
    .orderBy(asc(speakingAiSessionItems.ordinal));
  return { ...session, items };
}

/**
 * Ownership is folded into the lookup: another learner's session is
 * indistinguishable from a missing one, so this never leaks that it exists.
 */
export async function findAiSessionForUser(sessionId: string, userId: string): Promise<AiSessionWithItems | null> {
  const session = await selectSessionWithItems(sessionId);
  if (!session || session.userId !== userId) return null;
  return session;
}

export async function listAiSessionsForUser(userId: string, limit = 20): Promise<AiSessionRow[]> {
  return db
    .select()
    .from(speakingAiSessions)
    .where(eq(speakingAiSessions.userId, userId))
    .orderBy(desc(speakingAiSessions.createdAt))
    .limit(limit);
}

/**
 * Prompt ids this learner has recently answered, newest-first (§33).
 *
 * Used only to DE-PRIORITISE repetition. The planner falls back to the whole
 * pool when everything is recent, so a learner who has practised a lot is never
 * handed an empty session.
 */
export async function recentAnsweredPromptIds(userId: string, limit = 40): Promise<Set<string>> {
  const rows = await db
    .select({ promptId: speakingAttempts.promptId })
    .from(speakingAttempts)
    .where(and(eq(speakingAttempts.userId, userId), isNotNull(speakingAttempts.promptId)))
    .orderBy(desc(speakingAttempts.startedAt))
    .limit(limit);
  return new Set(rows.map((r) => r.promptId).filter((id): id is string => Boolean(id)));
}

/**
 * Attaches live prompt text to a persisted session.
 *
 * One query for every referenced prompt rather than one per item. An item whose
 * prompt row no longer exists comes back with `prompt: null` — the plan row
 * survives (its FK is `set null`), and the UI then says the question is
 * unavailable instead of inventing replacement text.
 */
export async function toAiSessionView(session: AiSessionWithItems): Promise<AiSessionView> {
  const promptIds = [...new Set(session.items.map((i) => i.promptId).filter((id): id is string => Boolean(id)))];
  const prompts = promptIds.length
    ? await db
        .select({
          id: speakingPrompts.id,
          part: speakingPrompts.part,
          topic: speakingPrompts.topic,
          promptText: speakingPrompts.promptText,
          cueCard: speakingPrompts.cueCard,
          prepSeconds: speakingPrompts.prepSeconds,
          answerSeconds: speakingPrompts.answerSeconds,
        })
        .from(speakingPrompts)
        .where(inArray(speakingPrompts.id, promptIds))
    : [];
  const byId = new Map(prompts.map((p) => [p.id, p]));

  return {
    ...session,
    items: session.items.map((item) => ({
      ...item,
      prompt: item.promptId ? byId.get(item.promptId) ?? null : null,
    })),
  };
}

/**
 * Gathers the stored evaluations behind a session, in the exact shape the pure
 * summary builder takes.
 *
 * This is the only place the summary meets the database: the builder itself does
 * no I/O, so the numbers it produces cannot come from anywhere except these rows.
 */
export async function loadSessionSummaryInput(session: AiSessionWithItems): Promise<SessionSummaryInput> {
  const attemptIds = session.items
    .map((i) => i.attemptId)
    .filter((id): id is string => Boolean(id));

  const evaluations = await findEvaluationsForSources({
    sourceType: "speaking_attempt",
    sourceIds: attemptIds,
  });

  return {
    mode: isSessionPlanMode(session.mode) ? session.mode : "full",
    // jsonb stores the limitation's part as text; narrow it here so the summary
    // receives the same closed vocabulary the planner produced.
    limitations: (session.limitations ?? []).map((limitation) => ({
      ...limitation,
      part: parsePart(limitation.part) ?? "part1",
    })),
    answers: session.items.map((item) => ({
      itemId: item.id,
      ordinal: item.ordinal,
      // The plan only ever stores practice parts; an unexpected value is treated
      // as part1 rather than silently dropped from the summary.
      part: parsePart(item.part) ?? "part1",
      topicKey: item.topicKey,
      topicTitle: item.topicTitle,
      questionPosition: item.questionPosition,
      clusterSize: item.clusterSize,
      isCueCard: item.isCueCard,
      status: item.status === "answered" || item.status === "skipped" ? item.status : "pending",
      attemptId: item.attemptId,
      evaluation: item.attemptId ? evaluations.get(item.attemptId) ?? null : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

/**
 * Persists a freshly built plan. Session and items are written in one
 * transaction so a half-created session (rows without a plan, or a plan without
 * rows) can never be observed.
 */
export async function createAiSession(input: {
  userId: string;
  mode: SessionPlanMode;
  plan: SessionPlan;
}): Promise<AiSessionWithItems> {
  const { userId, mode, plan } = input;

  const sessionId = await db.transaction(async (tx) => {
    const [session] = await tx
      .insert(speakingAiSessions)
      .values({
        userId,
        mode,
        status: "active",
        planVersion: plan.planVersion,
        sessionSeed: plan.seed,
        currentItemIndex: 0,
        limitations: plan.limitations,
      })
      .returning({ id: speakingAiSessions.id });
    const id = session!.id;

    if (plan.items.length > 0) {
      await tx.insert(speakingAiSessionItems).values(
        plan.items.map((item) => ({
          sessionId: id,
          ordinal: item.ordinal,
          promptId: item.promptId,
          part: item.part,
          topicKey: item.topicKey,
          topicTitle: item.topicTitle,
          topicPosition: item.topicPosition,
          questionPosition: item.questionPosition,
          clusterSize: item.clusterSize,
          isCueCard: item.isCueCard,
          status: "pending" as const,
        })),
      );
    }
    return id;
  });

  const created = await selectSessionWithItems(sessionId);
  if (!created) throw new Error("created speaking AI session could not be read back");
  return created;
}

// ---------------------------------------------------------------------------
// bind an answer
// ---------------------------------------------------------------------------

export type BindAttemptResult =
  | { ok: true; reused: boolean; session: AiSessionWithItems }
  | AiSessionFailure;

/**
 * Binds a submitted attempt to its plan item — the server half of "Send to RIWI".
 *
 * Checks, in order, all re-derived here rather than trusted from the request:
 *   - the session exists and belongs to this learner
 *   - the item exists and belongs to this session
 *   - the attempt exists and belongs to this learner
 *   - the attempt answers THIS item's prompt (a learner cannot bind an answer
 *     recorded for a different question, which would inflate the summary)
 *   - the attempt was really submitted (a bare `recording` row is not an answer)
 *   - if the item is already bound, the new attempt must be a genuine retry of
 *     the bound one (§30) — so an answer is replaced only by "Try again", and
 *     the earlier attempt is never overwritten or deleted
 *
 * Replaying the same request is a no-op that reports `reused: true` (§46/§81).
 */
export async function bindAttemptToSessionItem(input: {
  sessionId: string;
  itemId: string;
  attemptId: string;
  userId: string;
}): Promise<BindAttemptResult> {
  const { sessionId, itemId, attemptId, userId } = input;

  return db.transaction(async (tx) => {
    // Lock order is always session → item → attempt, so two concurrent binds on
    // the same session queue instead of deadlocking.
    const [session] = await tx
      .select()
      .from(speakingAiSessions)
      .where(eq(speakingAiSessions.id, sessionId))
      .limit(1)
      .for("update");
    if (!session || session.userId !== userId) return { ok: false, status: 404, error: "session_not_found" };
    if (session.status !== "active") return { ok: false, status: 409, error: "session_completed" };

    const [item] = await tx
      .select()
      .from(speakingAiSessionItems)
      .where(and(eq(speakingAiSessionItems.id, itemId), eq(speakingAiSessionItems.sessionId, sessionId)))
      .limit(1)
      .for("update");
    if (!item) return { ok: false, status: 404, error: "item_not_found" };

    const [attempt] = await tx
      .select()
      .from(speakingAttempts)
      .where(eq(speakingAttempts.id, attemptId))
      .limit(1);
    if (!attempt) return { ok: false, status: 404, error: "attempt_not_found" };
    if (attempt.userId !== userId) return { ok: false, status: 403, error: "forbidden" };
    if (item.promptId !== null && attempt.promptId !== item.promptId) {
      return { ok: false, status: 409, error: "attempt_prompt_mismatch" };
    }
    if (attempt.status !== "submitted") return { ok: false, status: 409, error: "attempt_not_submitted" };

    // Idempotent replay: the same attempt is already bound to this item.
    if (item.attemptId === attemptId && item.status === "answered") {
      await advanceCursor(tx, session, item.ordinal);
      return { ok: true, reused: true, session: await mustReadSession(tx, sessionId) };
    }

    // Rebinding is only for a real retry of the currently bound attempt.
    if (item.attemptId !== null && attempt.retryOfAttemptId !== item.attemptId) {
      return { ok: false, status: 409, error: "attempt_not_a_retry" };
    }

    await tx
      .update(speakingAiSessionItems)
      .set({ attemptId, status: "answered" })
      .where(eq(speakingAiSessionItems.id, item.id));
    await advanceCursor(tx, session, item.ordinal);

    return { ok: true, reused: false, session: await mustReadSession(tx, sessionId) };
  });
}

// ---------------------------------------------------------------------------
// skip
// ---------------------------------------------------------------------------

export type SkipItemResult = { ok: true; session: AiSessionWithItems } | AiSessionFailure;

/**
 * Records a skip and moves on. A skipped item keeps `attemptId = null`: skipping
 * never fabricates an answer, and the summary reports the question as not
 * answered rather than as a zero.
 */
export async function skipAiSessionItem(input: {
  sessionId: string;
  itemId: string;
  userId: string;
}): Promise<SkipItemResult> {
  const { sessionId, itemId, userId } = input;

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(speakingAiSessions)
      .where(eq(speakingAiSessions.id, sessionId))
      .limit(1)
      .for("update");
    if (!session || session.userId !== userId) return { ok: false, status: 404, error: "session_not_found" };
    if (session.status !== "active") return { ok: false, status: 409, error: "session_completed" };

    const [item] = await tx
      .select()
      .from(speakingAiSessionItems)
      .where(and(eq(speakingAiSessionItems.id, itemId), eq(speakingAiSessionItems.sessionId, sessionId)))
      .limit(1)
      .for("update");
    if (!item) return { ok: false, status: 404, error: "item_not_found" };

    // An answered question cannot be un-answered by a late skip request.
    if (item.status === "pending") {
      await tx.update(speakingAiSessionItems).set({ status: "skipped" }).where(eq(speakingAiSessionItems.id, item.id));
    }
    await advanceCursor(tx, session, item.ordinal);

    return { ok: true, session: await mustReadSession(tx, sessionId) };
  });
}

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

export type CompleteSessionResult = { ok: true; reused: boolean; session: AiSessionWithItems } | AiSessionFailure;

/** Finishing is idempotent: a second call returns the same completed session. */
export async function completeAiSession(input: { sessionId: string; userId: string }): Promise<CompleteSessionResult> {
  const { sessionId, userId } = input;

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(speakingAiSessions)
      .where(eq(speakingAiSessions.id, sessionId))
      .limit(1)
      .for("update");
    if (!session || session.userId !== userId) return { ok: false, status: 404, error: "session_not_found" };
    if (session.status === "completed") {
      return { ok: true, reused: true, session: await mustReadSession(tx, sessionId) };
    }

    await tx
      .update(speakingAiSessions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(speakingAiSessions.id, sessionId));

    return { ok: true, reused: false, session: await mustReadSession(tx, sessionId) };
  });
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

/**
 * Moves the cursor past `ordinal`, never backwards.
 *
 * max() is what makes a replayed or out-of-order request harmless: completing
 * question 2 after question 5 must not drop the learner back to question 3.
 */
async function advanceCursor(
  tx: Tx,
  session: AiSessionRow,
  ordinal: number,
): Promise<void> {
  const next = Math.max(session.currentItemIndex, ordinal + 1);
  if (next === session.currentItemIndex) return;
  await tx
    .update(speakingAiSessions)
    .set({ currentItemIndex: next })
    .where(eq(speakingAiSessions.id, session.id));
}

async function mustReadSession(
  tx: Tx,
  sessionId: string,
): Promise<AiSessionWithItems> {
  const [session] = await tx.select().from(speakingAiSessions).where(eq(speakingAiSessions.id, sessionId)).limit(1);
  const items = await tx
    .select()
    .from(speakingAiSessionItems)
    .where(eq(speakingAiSessionItems.sessionId, sessionId))
    .orderBy(asc(speakingAiSessionItems.ordinal));
  if (!session) throw new Error("speaking AI session vanished inside its own transaction");
  return { ...session, items };
}
