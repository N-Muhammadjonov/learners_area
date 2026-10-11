import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
  /**
   * Opaque keyset cursor for the next page, or null at the end.
   *
   * Search narrows the bank but does not make it reachable: one broad term can match
   * every prompt a centre has authored, and a bounded page with no continuation would
   * strand everything after the first one. The listing order
   * (part, external-id-nulls-last, external id, created at, id) is TOTAL, so a cursor
   * walks it exactly once — no duplicates, no omissions, and no unbounded response.
   */
  nextCursor: string | null;
  /** How many published prompts match in total. */
  matching: number;
  /** The page size this read was bounded to. */
  pageSize: number;
};

const SPEAKING_PARTS = ["part1", "part2", "part3", "general"] as const;
type SpeakingPart = (typeof SPEAKING_PARTS)[number];

type PromptCursor = {
  part: SpeakingPart;
  externalIsNull: boolean;
  externalId: string;
  createdAt: string;
  id: string;
};

function encodePromptCursor(row: {
  part: SpeakingPart;
  externalId: string | null;
  /**
   * MICROSECOND-precise, as text straight from Postgres.
   *
   * This used to be a JS Date, and `Date.toISOString()` truncates to
   * MILLISECONDS. Postgres stores timestamptz to the microsecond, so a row written
   * at .670005 produced the cursor .670, and `created_at > '...670Z'` was then TRUE
   * for that very row. The keyset never advanced: every "next page" returned the
   * SAME 500 rows with hasMore still true — an infinite walk in which nothing past
   * page one was reachable. Any bulk insert makes rows share a millisecond, so this
   * was reproducible with one statement.
   */
  createdAtText: string;
  id: string;
}): string {
  const payload = [row.part, row.externalId === null, row.externalId ?? "", row.createdAtText, row.id];
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePromptCursor(raw: string): PromptCursor {
  // A malformed cursor is refused. Falling back to page 1 would silently restart the
  // walk and re-serve prompts the room has already shown.
  const reject = () => new Error("invalid prompt cursor");
  if (raw.trim() === "") throw reject();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw reject();
  }
  if (
    !Array.isArray(parsed) || parsed.length !== 5 ||
    typeof parsed[0] !== "string" || !(SPEAKING_PARTS as readonly string[]).includes(parsed[0]) ||
    typeof parsed[1] !== "boolean" || typeof parsed[2] !== "string" ||
    typeof parsed[3] !== "string" || Number.isNaN(Date.parse(parsed[3])) ||
    typeof parsed[4] !== "string"
  ) {
    throw reject();
  }
  return {
    part: parsed[0] as SpeakingPart,
    externalIsNull: parsed[1],
    externalId: parsed[2],
    createdAt: parsed[3],
    id: parsed[4],
  };
}

export async function listLivePartnerQuestions(
  opts: { search?: string; cursor?: string } = {},
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

  // `external_id` is NULL for hand-authored prompts, and NULL breaks a naive row-value
  // comparison (it yields NULL, not true, so rows vanish). The null-ness flag is sorted
  // explicitly, which reproduces Postgres' default NULLS LAST for ascending order, and
  // coalesce keeps the compared value non-null.
  const sortKey = sql`(${speakingPrompts.part}, (${speakingPrompts.externalId} is null), coalesce(${speakingPrompts.externalId}, ''), ${speakingPrompts.createdAt}, ${speakingPrompts.id})`;
  const after = opts.cursor != null ? decodePromptCursor(opts.cursor) : null;
  const scope = after
    ? and(
        where,
        sql`${sortKey} > (${after.part}::speaking_part, ${after.externalIsNull}, ${after.externalId}, ${after.createdAt}::timestamptz, ${after.id}::uuid)`,
      )
    : where;

  const rows = await database
    .select({
      id: speakingPrompts.id,
      part: speakingPrompts.part,
      topic: speakingPrompts.topic,
      promptText: speakingPrompts.promptText,
      cueCard: speakingPrompts.cueCard,
      externalId: speakingPrompts.externalId,
      createdAt: speakingPrompts.createdAt,
      // Full microsecond precision for the cursor; a JS Date would round it away.
      createdAtText: sql<string>`to_char(${speakingPrompts.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(speakingPrompts)
    .where(scope)
    .orderBy(
      asc(speakingPrompts.part),
      sql`(${speakingPrompts.externalId} is null) asc`,
      sql`coalesce(${speakingPrompts.externalId}, '') asc`,
      asc(speakingPrompts.createdAt),
      asc(speakingPrompts.id),
    )
    .limit(LIVE_PARTNER_PAGE + 1);

  const hasMore = rows.length > LIVE_PARTNER_PAGE;
  const [{ matching = 0 } = {}] = await database
    .select({ matching: sql<number>`count(*)::int` })
    .from(speakingPrompts)
    .where(where);

  const page = hasMore ? rows.slice(0, LIVE_PARTNER_PAGE) : rows;
  const last = page[page.length - 1];
  return {
    // The ordering columns are an implementation detail of paging, not room data.
    questions: page.map(({ externalId: _externalId, createdAt: _createdAt, createdAtText: _createdAtText, ...question }) => question),
    hasMore,
    nextCursor: hasMore && last ? encodePromptCursor(last) : null,
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
/**
 * How many attempts one history read returns.
 *
 * Exported so a caller can report the bound instead of inferring that it received the whole
 * history. The read is bounded because an attempt history only ever grows: without a limit the
 * payload and the rows scanned grow with the learner's lifetime usage, and for a staff caller
 * with every learner's usage.
 */
export const ATTEMPT_HISTORY_LIMIT = 100;

export async function listAttempts(
  options: {
    userId?: string;
    attemptId?: string;
  },
  // Injectable executor, matching listLivePartnerQuestions above, so the read this
  // function performs can be exercised directly by a test.
  database: typeof db = db,
): Promise<AttemptWithPrompt[]> {
  const rows = options.attemptId
    ? await database.query.speakingAttempts.findMany({
        where: eq(speakingAttempts.id, options.attemptId),
        limit: 1,
      })
    : await database.query.speakingAttempts.findMany({
        where: options.userId ? eq(speakingAttempts.userId, options.userId) : undefined,
        orderBy: [desc(speakingAttempts.startedAt)],
        limit: ATTEMPT_HISTORY_LIMIT,
      });

  if (rows.length === 0) return [];

  // One query for all referenced prompts rather than one per attempt — RESTRICTED to
  // the ids actually referenced. `where: undefined` read the WHOLE prompt bank to
  // resolve at most 100 attempts: on a bank of a few thousand prompts the learner's
  // history page transferred the entire table (including every draft and archived
  // prompt) on every load, and the cost grew with the bank rather than with the
  // learner's history. The attempt list is already bounded at 100, so this read is
  // bounded by it.
  const promptIds = [...new Set(rows.map((r) => r.promptId).filter((id): id is string => Boolean(id)))];
  const prompts = promptIds.length
    ? await database.query.speakingPrompts.findMany({ where: inArray(speakingPrompts.id, promptIds) })
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §06 — SERVER-SIDE PAGINATION, PART/TOPIC DISCOVERY, SEARCH AND ON-DEMAND STUDY SUPPORT
 * for Speaking Practice and Speaking Practice with AI.
 *
 * These two pages used to call `listActivePrompts`, which has no LIMIT: at 10 000 published prompts
 * it read 10 007 rows and shipped 6.15 MB to the browser (docs/UNBOUNDED-READS.md), and the payload
 * grows with the bank. Everything a learner could browse was therefore decided by how much the server
 * was willing to send in one response.
 *
 * The paging design is deliberately the one already proven in this file for Live Partner, including
 * its hard-won details, rather than a new invention:
 *
 *   - The listing order (part, external-id-nulls-last, external id, created at, id) is TOTAL, so a
 *     keyset cursor walks it exactly once — no duplicates, no omissions, no unbounded response.
 *   - `created_at` is carried as MICROSECOND text straight from Postgres. A JS Date would round it to
 *     milliseconds and the cursor would never advance past a row written at .670005, stranding
 *     everything after page one.
 *   - A cursor the server did not mint is REFUSED, not silently reset to page 1.
 *
 * Eligibility is unchanged: `channelScope` below is the same `availableIn` predicate
 * `listActivePrompts` has always used, and publication rules are applied in the query, so drafts can
 * never surface and no previously eligible question becomes unreachable.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

export type SpeakingChannel = "practice_alone" | "ai";

/** How many prompts one learner-facing page carries. Bounded, and the cursor continues the walk. */
export const SPEAKING_PROMPT_PAGE = 100;
/** How many topic groups one discovery response carries, with the true total reported alongside. */
export const SPEAKING_TOPIC_PAGE = 500;

/**
 * The eligibility predicate, lifted verbatim from `listActivePrompts` so a bounded read can never
 * disagree with the unbounded one about which prompts a learner may see.
 */
function channelScope(channel: SpeakingChannel) {
  return and(
    liveWhere({ publicationState: speakingPrompts.publicationState, publishAt: speakingPrompts.publishAt }),
    channel === "ai"
      ? sql`(${speakingPrompts.availableIn} @> '["ai"]'::jsonb OR ${speakingPrompts.availableIn} @> '["practice_alone"]'::jsonb)`
      : sql`(${speakingPrompts.availableIn} @> '["practice_alone"]'::jsonb OR ${speakingPrompts.availableIn} @> '["live_partner"]'::jsonb)`,
  );
}

/**
 * The client-side `topicKey` from lib/speaking/practice-browse.ts, expressed in SQL so discovery and
 * filtering happen against the whole corpus instead of against whatever was already shipped to the
 * browser: trim, lowercase, and one `__untitled__` bucket for rows with no topic — so nothing
 * published is hidden by having no topic.
 */
const TOPIC_KEY = sql`case when ${speakingPrompts.topic} is null or btrim(${speakingPrompts.topic}) = '' then '__untitled__' else lower(btrim(${speakingPrompts.topic})) end`;

export type SpeakingPromptPage = {
  prompts: {
    id: string;
    part: typeof speakingPrompts.$inferSelect["part"];
    topic: string | null;
    promptText: string;
    cueCard: string | null;
  }[];
  /** True when more published prompts match than were returned. */
  hasMore: boolean;
  /** Opaque keyset cursor for the next page, or null at the end. */
  nextCursor: string | null;
  /** How many published prompts match the filters in total. */
  matching: number;
  /** The page size this read was bounded to. */
  pageSize: number;
};

export type SpeakingPromptFilters = {
  channel?: SpeakingChannel;
  /** One of part1/part2/part3/general, or null for every part. */
  part?: string | null;
  /** A topic key as produced by discovery, or null for every topic. */
  topic?: string | null;
  search?: string;
  cursor?: string | null;
};

/** One bounded page of prompts, narrowed server-side against the full published corpus. */
export async function listSpeakingPromptPage(
  opts: SpeakingPromptFilters = {},
  database: typeof db = db,
): Promise<SpeakingPromptPage> {
  const channel = opts.channel ?? "practice_alone";
  const conditions = [channelScope(channel)];
  if (opts.part) conditions.push(eq(speakingPrompts.part, opts.part as typeof speakingPrompts.$inferSelect["part"]));
  if (opts.topic) conditions.push(sql`${TOPIC_KEY} = ${opts.topic}`);
  const term = (opts.search ?? "").trim();
  if (term) {
    conditions.push(
      sql`(${speakingPrompts.promptText} ilike ${`%${term}%`} or ${speakingPrompts.topic} ilike ${`%${term}%`})`,
    );
  }
  const where = and(...conditions);

  // Same total order and same null-safe row-value comparison as the Live Partner walk.
  const sortKey = sql`(${speakingPrompts.part}, (${speakingPrompts.externalId} is null), coalesce(${speakingPrompts.externalId}, ''), ${speakingPrompts.createdAt}, ${speakingPrompts.id})`;
  const after = opts.cursor != null ? decodePromptCursor(opts.cursor) : null;
  const scope = after
    ? and(
        where,
        sql`${sortKey} > (${after.part}::speaking_part, ${after.externalIsNull}, ${after.externalId}, ${after.createdAt}::timestamptz, ${after.id}::uuid)`,
      )
    : where;

  const rows = await database
    .select({
      id: speakingPrompts.id,
      part: speakingPrompts.part,
      topic: speakingPrompts.topic,
      promptText: speakingPrompts.promptText,
      cueCard: speakingPrompts.cueCard,
      externalId: speakingPrompts.externalId,
      createdAtText: sql<string>`to_char(${speakingPrompts.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(speakingPrompts)
    .where(scope)
    .orderBy(
      asc(speakingPrompts.part),
      sql`(${speakingPrompts.externalId} is null) asc`,
      sql`coalesce(${speakingPrompts.externalId}, '') asc`,
      asc(speakingPrompts.createdAt),
      asc(speakingPrompts.id),
    )
    .limit(SPEAKING_PROMPT_PAGE + 1);

  const hasMore = rows.length > SPEAKING_PROMPT_PAGE;
  const [{ matching = 0 } = {}] = await database
    .select({ matching: sql<number>`count(*)::int` })
    .from(speakingPrompts)
    .where(where);

  const page = hasMore ? rows.slice(0, SPEAKING_PROMPT_PAGE) : rows;
  const last = page[page.length - 1];
  return {
    // The ordering columns are an implementation detail of paging, not learner data.
    prompts: page.map(({ externalId: _e, createdAtText: _c, ...prompt }) => prompt),
    hasMore,
    nextCursor: hasMore && last ? encodePromptCursor(last) : null,
    matching,
    pageSize: SPEAKING_PROMPT_PAGE,
  };
}

export type SpeakingFacets = {
  /** Every part the learner may practise, with how many published prompts it holds. */
  parts: { part: string; count: number }[];
  /** Topic groups for one part, or an empty list when no part is chosen yet. */
  topics: { key: string; title: string | null; count: number }[];
  /** How many topic groups exist in total for that part — may exceed the page returned. */
  topicCount: number;
  /** How many published prompts match the channel and search in total. */
  matching: number;
};

/**
 * Part and topic discovery, as bounded aggregates over the whole corpus. A learner choosing "Part 2"
 * needs the true question count and the true topic list; neither can come from a page of prompts, so
 * both are counted here instead of being inferred from whatever was already shipped.
 */
export async function speakingFacets(
  opts: { channel?: SpeakingChannel; part?: string | null; search?: string } = {},
  database: typeof db = db,
): Promise<SpeakingFacets> {
  const channel = opts.channel ?? "practice_alone";
  const term = (opts.search ?? "").trim();
  const base = [channelScope(channel)];
  if (term) {
    base.push(sql`(${speakingPrompts.promptText} ilike ${`%${term}%`} or ${speakingPrompts.topic} ilike ${`%${term}%`})`);
  }
  const where = and(...base);

  const partRows = await database
    .select({ part: sql<string>`${speakingPrompts.part}`, count: sql<number>`count(*)::int` })
    .from(speakingPrompts)
    .where(where)
    .groupBy(speakingPrompts.part)
    .orderBy(asc(speakingPrompts.part));

  const matching = partRows.reduce((total, row) => total + row.count, 0);

  if (!opts.part) return { parts: partRows, topics: [], topicCount: 0, matching };

  const partWhere = and(where, eq(speakingPrompts.part, opts.part as typeof speakingPrompts.$inferSelect["part"]));
  const topicRows = await database
    .select({
      key: sql<string>`${TOPIC_KEY}`,
      title: sql<string | null>`nullif(btrim(${speakingPrompts.topic}), '')`,
      count: sql<number>`count(*)::int`,
    })
    .from(speakingPrompts)
    .where(partWhere)
    .groupBy(sql`${TOPIC_KEY}`, sql`nullif(btrim(${speakingPrompts.topic}), '')`)
    .orderBy(sql`${TOPIC_KEY} asc`)
    .limit(SPEAKING_TOPIC_PAGE + 1);

  const [{ topicCount = 0 } = {}] = await database
    .select({ topicCount: sql<number>`count(distinct ${TOPIC_KEY})::int` })
    .from(speakingPrompts)
    .where(partWhere);

  return {
    parts: partRows,
    topics: topicRows.slice(0, SPEAKING_TOPIC_PAGE),
    topicCount,
    matching,
  };
}

/**
 * Study support for ONE prompt, fetched when the learner actually selects it.
 *
 * `study_support` carries the model answer, the ideas and the vocabulary HTML — the heaviest part of a
 * prompt row. Shipping it for every prompt in the bank is what made the payload grow with the corpus,
 * and a learner only ever reads one question's support at a time. Publication and eligibility are
 * enforced here, so this cannot be used to read a draft or a prompt the channel does not allow.
 */
export async function findPublishedPromptSupport(
  promptId: string,
  channel: SpeakingChannel = "practice_alone",
  database: typeof db = db,
) {
  const rows = await database
    .select({ id: speakingPrompts.id, studySupport: speakingPrompts.studySupport })
    .from(speakingPrompts)
    .where(and(eq(speakingPrompts.id, promptId), channelScope(channel)))
    .limit(1);
  return rows[0] ?? null;
}
