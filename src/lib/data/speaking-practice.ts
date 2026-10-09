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

type LivePartnerCursor = {
  part: SpeakingPart;
  externalIsNull: boolean;
  externalId: string;
  createdAt: string;
  id: string;
};

function encodeLivePartnerCursor(row: {
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

function decodeLivePartnerCursor(raw: string): LivePartnerCursor {
  // A malformed cursor is refused. Falling back to page 1 would silently restart the
  // walk and re-serve prompts the room has already shown.
  const reject = () => new Error("invalid live-partner cursor");
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
  const after = opts.cursor != null ? decodeLivePartnerCursor(opts.cursor) : null;
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
    nextCursor: hasMore && last ? encodeLivePartnerCursor(last) : null,
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
        limit: 100,
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
