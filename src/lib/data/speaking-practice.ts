import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts, speakingPrompts } from "@/db/schema";
import { isLive, liveWhere } from "@/lib/services/cms/publication";
import { topicKey } from "@/lib/speaking/practice-browse";
import { PART1_QUESTIONS, PART3_QUESTIONS, type AiMode } from "@/lib/speaking/ai-session";

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

/**
 * The fields a learner-facing speaking screen actually renders.
 *
 * §5.1: `QuestionRecorder` depends on `prepSeconds` and `answerSeconds` to run its preparation and
 * answer timers, and the first version of the paged response omitted both — which would have made the
 * bounded page unusable by the very component it was meant to feed, or silently reset a recorder's
 * timers to defaults. The contract is reconciled here rather than in the component: a paged prompt
 * carries everything the recorder needs, so a page response and a full row are interchangeable for it.
 *
 * `studySupport` is deliberately NOT here. It is the heaviest field on the row and is fetched on demand
 * for the one question a learner selects.
 */
export type PagedSpeakingPrompt = {
  id: string;
  part: typeof speakingPrompts.$inferSelect["part"];
  topic: string | null;
  promptText: string;
  cueCard: string | null;
  prepSeconds: number;
  answerSeconds: number;
};

export type SpeakingPromptPage = {
  prompts: PagedSpeakingPrompt[];
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
      prepSeconds: speakingPrompts.prepSeconds,
      answerSeconds: speakingPrompts.answerSeconds,
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
  /** One topic group per NORMALIZED key, or an empty list when no part is chosen yet. */
  topics: { key: string; title: string | null; count: number }[];
  /** How many topic groups exist in total for that part — may exceed the page returned. */
  topicCount: number;
  /** True when more topic groups match than this page returned. */
  hasMoreTopics: boolean;
  /**
   * Opaque keyset cursor for the next topic page, or null at the end.
   *
   * Reporting `topicCount` without a continuation is not a neutral omission: a centre that authored
   * more topics than one page carries would see the first page, be told a larger total exists, and
   * have no way to reach the rest through the intended Part → Topic journey. The topic order
   * (`TOPIC_KEY` ascending) is total, so a cursor walks it exactly once.
   */
  nextTopicCursor: string | null;
  /** How many published prompts match the channel and search in total. */
  matching: number;
};

/**
 * Topic cursors are the last normalized key seen, wrapped so a caller cannot forge or guess one.
 *
 * `TOPIC_KEY` is a single text column ordered ascending, which is already a total order — unlike the
 * prompt walk it needs no null-flag or timestamp component, and therefore has no microsecond hazard.
 */
function encodeTopicCursor(key: string): string {
  return Buffer.from(JSON.stringify({ k: key }), "utf8").toString("base64url");
}

function decodeTopicCursor(raw: string): string {
  // Refused, never silently reset to the first page: that would re-serve topics already shown and
  // could strand everything after them again.
  const reject = () => new Error("invalid topic cursor");
  if (raw.trim() === "") throw reject();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw reject();
  }
  const key = (parsed as { k?: unknown } | null)?.k;
  if (typeof key !== "string" || key === "") throw reject();
  return key;
}

/**
 * Part and topic discovery, as bounded aggregates over the whole corpus. A learner choosing "Part 2"
 * needs the true question count and the true topic list; neither can come from a page of prompts, so
 * both are counted here instead of being inferred from whatever was already shipped.
 */
export async function speakingFacets(
  opts: {
    channel?: SpeakingChannel;
    part?: string | null;
    search?: string;
    /** Opaque continuation minted by a previous call's `nextTopicCursor`. */
    topicCursor?: string | null;
  } = {},
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

  if (!opts.part) {
    return { parts: partRows, topics: [], topicCount: 0, hasMoreTopics: false, nextTopicCursor: null, matching };
  }

  const partWhere = and(where, eq(speakingPrompts.part, opts.part as typeof speakingPrompts.$inferSelect["part"]));
  // Continuation is applied to the page query only. `topicCount` below stays the corpus-wide total,
  // so every page reports the same true number rather than shrinking as the walk advances.
  const afterTopicKey = opts.topicCursor != null ? decodeTopicCursor(opts.topicCursor) : null;
  const topicScope = afterTopicKey ? and(partWhere, sql`${TOPIC_KEY} > ${afterTopicKey}`) : partWhere;

  const topicRows = await database
    .select({
      key: sql<string>`${TOPIC_KEY}`,
      /*
       * ONE deterministic representative title per normalized key.
       *
       * V17 grouped by the key AND the raw trimmed title, which emitted one row per surface form:
       * "QA-TOPIC-0001", "qa-topic-0001" and "   QA-TOPIC-0001   " all normalize to the key
       * `qa-topic-0001` but produced three separate groups carrying fragmented counts (measured: 4
       * and 1, neither of them the true 5). A client rendering that list drew several buttons that
       * all navigated to the same ?topic= and each showed a different, wrong count.
       *
       * `min()` over the trimmed title is deterministic and picks a real authored surface form, so
       * the label is still something a teacher actually typed — never an invented one.
       */
      title: sql<string | null>`min(nullif(btrim(${speakingPrompts.topic}), ''))`,
      count: sql<number>`count(*)::int`,
    })
    .from(speakingPrompts)
    .where(topicScope)
    .groupBy(sql`${TOPIC_KEY}`)
    .orderBy(sql`${TOPIC_KEY} asc`)
    .limit(SPEAKING_TOPIC_PAGE + 1);

  const [{ topicCount = 0 } = {}] = await database
    .select({ topicCount: sql<number>`count(distinct ${TOPIC_KEY})::int` })
    .from(speakingPrompts)
    .where(partWhere);

  const hasMoreTopics = topicRows.length > SPEAKING_TOPIC_PAGE;
  const topics = hasMoreTopics ? topicRows.slice(0, SPEAKING_TOPIC_PAGE) : topicRows;
  const lastTopic = topics[topics.length - 1];

  return {
    parts: partRows,
    topics,
    topicCount,
    hasMoreTopics,
    nextTopicCursor: hasMoreTopics && lastTopic ? encodeTopicCursor(lastTopic.key) : null,
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * §05 — BOUNDED, SERVER-AUTHORITATIVE EXAM QUESTION SELECTION for Speaking Practice with AI.
 *
 * `AiExaminerSession` used to build its script with `buildExaminerScript(prompts, mode)` over the
 * complete published bank held in the browser. The obvious "fix" — selecting from the first bounded
 * page instead — is explicitly forbidden, and rightly so: it would bias every exam toward whichever
 * prompts happen to sort first and make later ones unreachable, turning a performance defect into a
 * fairness defect. A learner's Part 2 cue card must be drawn from the whole corpus.
 *
 * So selection moved here, and stays UNBIASED while every response stays BOUNDED. Each step asks the
 * database for one aggregate or at most `PART1_QUESTIONS` rows, never for the corpus:
 *
 *   - a topic is chosen uniformly among the part's topic GROUPS (`GROUP BY key ORDER BY random()
 *     LIMIT 1`), which is exactly what `pick(groups)` did in memory;
 *   - Part 1 and Part 3 then take the first N prompts of that topic in listing order, matching
 *     `.prompts.slice(0, N)`;
 *   - Part 2 draws one prompt uniformly WITHIN the chosen topic, matching `pick(group.prompts)`.
 *
 * The two-stage shape is preserved on purpose. Picking uniformly over prompts instead of uniformly
 * over topics and then within a topic would silently re-weight the exam toward topics that happen to
 * hold more questions — a behaviour change nobody asked for.
 *
 * Part 3 still prefers the Part 2 cue card's own topic, falling back to a random Part 3 topic only when
 * the corpus has no Part 3 questions on it. Nothing is invented, no draft can appear (publication and
 * channel eligibility are in every predicate), and a part with no published prompts is simply absent
 * from the script — the same contract as before.
 *
 * `ORDER BY random()` scans the part's rows to draw one key. That is a deliberate trade and it is
 * honest to name it: the alternative is biasing selection to the first page, which is the thing this
 * must not do. It runs once per exam start and returns one row.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

const EXAM_COLUMNS = {
  id: speakingPrompts.id,
  part: speakingPrompts.part,
  topic: speakingPrompts.topic,
  promptText: speakingPrompts.promptText,
  cueCard: speakingPrompts.cueCard,
  prepSeconds: speakingPrompts.prepSeconds,
  answerSeconds: speakingPrompts.answerSeconds,
};

type ExamPart = "part1" | "part2" | "part3";

/**
 * Draw the examiner's script for one mode, from the whole published corpus, without ever loading it.
 * Returns the same shape `buildExaminerScript` produced, so the session component and `QuestionRecorder`
 * are unaffected apart from where the questions come from.
 */
export async function selectExaminerScript(
  opts: { mode: AiMode; channel?: SpeakingChannel },
  database: typeof db = db,
): Promise<PagedSpeakingPrompt[]> {
  const base = channelScope(opts.channel ?? "ai");
  const inPart = (part: ExamPart) => and(base, eq(speakingPrompts.part, part));

  const partHasQuestions = async (part: ExamPart) => {
    const rows = await database
      .select({ n: sql<number>`count(*)::int` })
      .from(speakingPrompts)
      .where(inPart(part));
    return (rows[0]?.n ?? 0) > 0;
  };

  /** One topic key drawn uniformly among the part's topic groups. */
  const randomTopicKey = async (part: ExamPart) => {
    const rows = await database
      .select({ key: sql<string>`${TOPIC_KEY}` })
      .from(speakingPrompts)
      .where(inPart(part))
      .groupBy(sql`${TOPIC_KEY}`)
      .orderBy(sql`random()`)
      .limit(1);
    return rows[0]?.key ?? null;
  };

  const topicExists = async (part: ExamPart, key: string) => {
    const rows = await database
      .select({ id: speakingPrompts.id })
      .from(speakingPrompts)
      .where(and(inPart(part), sql`${TOPIC_KEY} = ${key}`))
      .limit(1);
    return rows.length > 0;
  };

  /** The first `limit` prompts of one topic, in the same listing order the in-memory version used. */
  const firstInTopic = async (part: ExamPart, key: string, limit: number) =>
    database
      .select(EXAM_COLUMNS)
      .from(speakingPrompts)
      .where(and(inPart(part), sql`${TOPIC_KEY} = ${key}`))
      .orderBy(asc(speakingPrompts.createdAt), asc(speakingPrompts.id))
      .limit(limit);

  /** One prompt drawn uniformly within a topic — Part 2's cue card. */
  const randomInTopic = async (part: ExamPart, key: string) =>
    database
      .select(EXAM_COLUMNS)
      .from(speakingPrompts)
      .where(and(inPart(part), sql`${TOPIC_KEY} = ${key}`))
      .orderBy(sql`random()`)
      .limit(1);

  const { mode } = opts;
  const script: PagedSpeakingPrompt[] = [];
  let cueTopic: string | null = null;

  if ((mode === "full" || mode === "part1") && (await partHasQuestions("part1"))) {
    const key = await randomTopicKey("part1");
    if (key) script.push(...(await firstInTopic("part1", key, PART1_QUESTIONS)));
  }

  if ((mode === "full" || mode === "part2") && (await partHasQuestions("part2"))) {
    const key = await randomTopicKey("part2");
    if (key) {
      const [cue] = await randomInTopic("part2", key);
      if (cue) {
        cueTopic = topicKey(cue.topic);
        script.push(cue);
      }
    }
  }

  if ((mode === "full" || mode === "part3") && (await partHasQuestions("part3"))) {
    // Prefer the cue card's own topic, exactly as the in-memory version did; fall back only when the
    // corpus holds no Part 3 questions on it.
    const key =
      cueTopic !== null && (await topicExists("part3", cueTopic))
        ? cueTopic
        : await randomTopicKey("part3");
    if (key) script.push(...(await firstInTopic("part3", key, PART3_QUESTIONS)));
  }

  return script;
}
