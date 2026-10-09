import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts, speakingPrompts } from "@/db/schema";
import { isLive, liveWhere } from "@/lib/services/cms/publication";

/** Prompts a student may practise against, in a stable order. */
export async function listActivePrompts(channel: "practice_alone" | "ai" = "practice_alone") {
  return db.query.speakingPrompts.findMany({
    where: and(
      liveWhere({ publicationState: speakingPrompts.publicationState, publishAt: speakingPrompts.publishAt }),
      channel === "ai" ? sql`(${speakingPrompts.availableIn} @> '["ai"]'::jsonb OR ${speakingPrompts.availableIn} @> '["practice_alone"]'::jsonb)` : sql`(${speakingPrompts.availableIn} @> '["practice_alone"]'::jsonb OR ${speakingPrompts.availableIn} @> '["live_partner"]'::jsonb)`,
    ),
    orderBy: [asc(speakingPrompts.part), asc(speakingPrompts.createdAt)],
  });
}

/**
 * Live Partner questions come from the SAME canonical `speaking_prompts` rows as
 * Practice (one bank, one publication rule); only the channel flag differs.
 * Minimal columns, bounded — optional conversation aids, not an exam script.
 */
const LIVE_PARTNER_PAGE = 500;

export type LivePartnerQuestionPage = {
  questions: {
    id: string;
    part: typeof speakingPrompts.$inferSelect["part"];
    topic: string | null;
    promptText: string;
    cueCard: string | null;
  }[];
  /** True when more published prompts match than were returned. */
  hasMore: boolean;
  /** How many published prompts match in total. */
  matching: number;
  /** The page size this read was bounded to. */
  pageSize: number;
};

export async function listLivePartnerQuestions(
  opts: { search?: string } = {},
  database: typeof db = db,
): Promise<LivePartnerQuestionPage> {
  // The room used to ship the whole bank to the browser and filter it there, so prompts
  // past the limit could never be found. The read stays bounded; narrowing happens here,
  // against the full published corpus, so every prompt remains reachable.
  const channel = and(
    liveWhere({ publicationState: speakingPrompts.publicationState, publishAt: speakingPrompts.publishAt }),
    sql`(${speakingPrompts.availableIn} @> '["practice_alone"]'::jsonb OR ${speakingPrompts.availableIn} @> '["live_partner"]'::jsonb)`,
  );
  const term = (opts.search ?? "").trim();
  const where = term
    ? and(channel, sql`(${speakingPrompts.promptText} ilike ${`%${term}%`} or ${speakingPrompts.topic} ilike ${`%${term}%`})`)
    : channel;

  const rows = await database
    .select({ id: speakingPrompts.id, part: speakingPrompts.part, topic: speakingPrompts.topic, promptText: speakingPrompts.promptText, cueCard: speakingPrompts.cueCard })
    .from(speakingPrompts)
    .where(where)
    .orderBy(asc(speakingPrompts.part), asc(speakingPrompts.externalId), asc(speakingPrompts.createdAt), asc(speakingPrompts.id))
    .limit(LIVE_PARTNER_PAGE + 1);

  const hasMore = rows.length > LIVE_PARTNER_PAGE;
  const [{ matching = 0 } = {}] = await database
    .select({ matching: sql<number>`count(*)::int` })
    .from(speakingPrompts)
    .where(where);

  return {
    questions: hasMore ? rows.slice(0, LIVE_PARTNER_PAGE) : rows,
    hasMore,
    matching,
    pageSize: LIVE_PARTNER_PAGE,
  };
}

export type LivePartnerQuestion = LivePartnerQuestionPage["questions"][number];

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
