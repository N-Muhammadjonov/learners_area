import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts, speakingPrompts } from "@/db/schema";
import { isLive, liveWhere } from "@/lib/services/cms/publication";

/** Prompts a student may practise against, in a stable order. */
export async function listActivePrompts(database: typeof db = db) {
  return database.query.speakingPrompts.findMany({
    where: and(
      liveWhere({ publicationState: speakingPrompts.publicationState, publishAt: speakingPrompts.publishAt }),
      sql`${speakingPrompts.availableIn} @> '["practice_alone"]'::jsonb`,
    ),
    orderBy: [asc(speakingPrompts.part), asc(speakingPrompts.createdAt)],
  });
}

/**
 * Live Partner questions come from the SAME canonical `speaking_prompts` rows as
 * Practice (one bank, one publication rule); only the channel flag differs.
 * Minimal columns, bounded — optional conversation aids, not an exam script.
 */
export async function listLivePartnerQuestions() {
  return db.select({ id: speakingPrompts.id, part: speakingPrompts.part, topic: speakingPrompts.topic, promptText: speakingPrompts.promptText, cueCard: speakingPrompts.cueCard })
    .from(speakingPrompts)
    .where(and(
      liveWhere({ publicationState: speakingPrompts.publicationState, publishAt: speakingPrompts.publishAt }),
      sql`${speakingPrompts.availableIn} @> '["live_partner"]'::jsonb`,
    ))
    .orderBy(asc(speakingPrompts.part), asc(speakingPrompts.externalId), asc(speakingPrompts.createdAt))
    .limit(1500);
}
export type LivePartnerQuestion = Awaited<ReturnType<typeof listLivePartnerQuestions>>[number];

export type AttemptWithPrompt = typeof speakingAttempts.$inferSelect & {
  prompt: typeof speakingPrompts.$inferSelect | null;
};

/**
 * Attempt history with the prompt attached. `withPrompt` narrows the query for
 * a single attempt; without it, every attempt for the caller is returned
 * newest-first.
 */
export async function listAttempts(options: {
  userId?: string;
  attemptId?: string;
}): Promise<AttemptWithPrompt[]> {
  const rows = options.attemptId
    ? await db.query.speakingAttempts.findMany({
        where: eq(speakingAttempts.id, options.attemptId),
        limit: 1,
      })
    : await db.query.speakingAttempts.findMany({
        where: options.userId ? eq(speakingAttempts.userId, options.userId) : undefined,
        orderBy: [desc(speakingAttempts.startedAt)],
        limit: 100,
      });

  if (rows.length === 0) return [];

  // One query for all referenced prompts rather than one per attempt.
  const promptIds = [...new Set(rows.map((r) => r.promptId).filter((id): id is string => Boolean(id)))];
  const prompts = promptIds.length
    ? await db.query.speakingPrompts.findMany({ where: undefined })
    : [];
  const byId = new Map(prompts.map((p) => [p.id, p]));

  return rows.map((row) => ({ ...row, prompt: row.promptId ? byId.get(row.promptId) ?? null : null }));
}

/** Existence + ownership check used by the attempt routes. */
export async function findAttemptForUser(attemptId: string, userId: string) {
  return db.query.speakingAttempts.findFirst({
    where: and(eq(speakingAttempts.id, attemptId), eq(speakingAttempts.userId, userId)),
  });
}
