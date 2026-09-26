import { and, asc, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts, readingPassages, readingQuestions } from "@/db/schema";
import { liveWhere } from "@/lib/services/cms/publication";

/**
 * The reading library: 105 passages, filtered the way a student actually looks
 * for practice.
 *
 * Two things shape this file.
 *
 * First, the list is big now. A student who opens Reading and sees one hundred
 * and five identical cards has not been given a library, they have been given a
 * wall — so filtering, counting and paging all happen in the database, and the
 * page only ever renders one screen of cards.
 *
 * Second, the status shown on a card must be true. "Bajarilgan" is not a flag
 * somebody set; it is read back from the student's own attempts, so a card can
 * never claim finished work that was never done.
 *
 * `liveWhere` gates everything: a draft or a not-yet-due schedule is invisible
 * here, exactly as it is everywhere else in the product.
 */

export const READING_PAGE_SIZE = 24;

export type ReadingLibraryFilter = {
  /** all | passage1 | passage2 | passage3 | completed | in_progress | not_started */
  status?: string;
  topic?: string;
  /** Source question-type code (TFNG, MH, NOTE, …). */
  type?: string;
  /** Free text over the passage title. */
  query?: string;
  page?: number;
};

export type ReadingPassageCard = {
  id: string;
  title: string;
  testNo: number | null;
  passageNo: number | null;
  topicCode: string | null;
  questionCount: number;
  suggestedMinutes: number;
  /** in_progress | completed | not_started */
  status: "in_progress" | "completed" | "not_started";
  lastScore: number | null;
  lastAttemptId: string | null;
};

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The WHERE clause for the library filters, shared by the page, the count and
 * the filter options so the three can never disagree about what a filter means.
 *
 * "AND" is the whole story here: choosing topic "health" and type "TFNG" must
 * show passages that are both, not either. That is why the type filter is a
 * correlated EXISTS instead of a join — a join would repeat passages that carry
 * the type twice and quietly break the count.
 */
function libraryWhere(userId: string, filter: ReadingLibraryFilter) {
  const clauses = [
    liveWhere({
      publicationState: readingPassages.publicationState,
      publishAt: readingPassages.publishAt,
    }),
  ];

  if (filter.status === "passage1") clauses.push(eq(readingPassages.passageNo, 1));
  if (filter.status === "passage2") clauses.push(eq(readingPassages.passageNo, 2));
  if (filter.status === "passage3") clauses.push(eq(readingPassages.passageNo, 3));

  const topic = text(filter.topic);
  if (topic) clauses.push(eq(readingPassages.topicCode, topic));

  const type = text(filter.type);
  if (type) {
    clauses.push(
      sql`exists (select 1 from ${readingQuestions} q where q.passage_id = ${readingPassages.id} and q.type_code = ${type})`
    );
  }

  const query = text(filter.query);
  if (query) clauses.push(ilike(readingPassages.title, `%${query.replace(/[%_\\]/g, (m) => "\\" + m)}%`));

  if (filter.status === "completed") {
    clauses.push(
      sql`exists (select 1 from ${readingAttempts} a
                   where a.passage_id = ${readingPassages.id} and a.user_id = ${userId} and a.status = 'completed')`
    );
  }
  if (filter.status === "in_progress") {
    clauses.push(
      sql`exists (select 1 from ${readingAttempts} a
                   where a.passage_id = ${readingPassages.id} and a.user_id = ${userId} and a.status = 'in_progress')`
    );
  }
  if (filter.status === "not_started") {
    clauses.push(
      sql`not exists (select 1 from ${readingAttempts} a
                        where a.passage_id = ${readingPassages.id} and a.user_id = ${userId})`
    );
  }

  return and(...clauses);
}

/** How many passages each filter state would show — the counts on the tabs. */
export async function countLibrary(userId: string, filter: ReadingLibraryFilter = {}) {
  const rows = await db
    .select({ value: count() })
    .from(readingPassages)
    .where(libraryWhere(userId, filter));
  return Number(rows[0]?.value ?? 0);
}

/**
 * One page of the library, with the student's own attempt state attached.
 *
 * The attempts are fetched in a single follow-up query over the page's ids
 * rather than joined per row: the status of a card is "the most recent attempt",
 * which a plain join cannot express without grouping, and grouping over a join
 * is where wrong totals come from.
 */
export async function listLibrary(
  userId: string,
  filter: ReadingLibraryFilter = {}
): Promise<{ items: ReadingPassageCard[]; total: number; page: number; pageCount: number }> {
  const where = libraryWhere(userId, filter);
  const page = Math.max(1, Math.floor(filter.page ?? 1));

  const [totalRows, questionCounts] = await Promise.all([
    db.select({ value: count() }).from(readingPassages).where(where),
    db
      .select({ passageId: readingQuestions.passageId, value: count() })
      .from(readingQuestions)
      .groupBy(readingQuestions.passageId),
  ]);

  const total = Number(totalRows[0]?.value ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / READING_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  const passages = await db
    .select({
      id: readingPassages.id,
      title: readingPassages.title,
      testNo: readingPassages.testNo,
      passageNo: readingPassages.passageNo,
      topicCode: readingPassages.topicCode,
      suggestedMinutes: readingPassages.suggestedMinutes,
    })
    .from(readingPassages)
    .where(where)
    .orderBy(asc(readingPassages.testNo), asc(readingPassages.passageNo), asc(readingPassages.title))
    .limit(READING_PAGE_SIZE)
    .offset((safePage - 1) * READING_PAGE_SIZE);

  const ids = passages.map((passage) => passage.id);
  const attempts = ids.length
    ? await db
        .select({
          id: readingAttempts.id,
          passageId: readingAttempts.passageId,
          status: readingAttempts.status,
          score: readingAttempts.score,
          startedAt: readingAttempts.startedAt,
          submittedAt: readingAttempts.submittedAt,
        })
        .from(readingAttempts)
        .where(and(eq(readingAttempts.userId, userId), inArray(readingAttempts.passageId, ids)))
        .orderBy(desc(readingAttempts.startedAt))
    : [];

  const questionCountByPassage = new Map(questionCounts.map((row) => [row.passageId, Number(row.value)]));
  const latestByPassage = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (!latestByPassage.has(attempt.passageId)) latestByPassage.set(attempt.passageId, attempt);
  }

  const items: ReadingPassageCard[] = passages.map((passage) => {
    const latest = latestByPassage.get(passage.id);
    const status: ReadingPassageCard["status"] = !latest
      ? "not_started"
      : latest.status === "completed"
        ? "completed"
        : "in_progress";
    return {
      id: passage.id,
      title: passage.title,
      testNo: passage.testNo,
      passageNo: passage.passageNo,
      topicCode: passage.topicCode,
      questionCount: questionCountByPassage.get(passage.id) ?? 0,
      suggestedMinutes: passage.suggestedMinutes,
      status,
      lastScore: latest?.status === "completed" ? latest.score : null,
      lastAttemptId: latest && latest.status === "in_progress" ? latest.id : null,
    };
  });

  return { items, total, page: safePage, pageCount };
}

/**
 * The values a student can filter by, taken from the library itself.
 *
 * Nothing is hard-coded: if a topic or question type is not present in the
 * published library it does not appear in the dropdown, so a filter can never
 * lead to an empty screen.
 */
export async function listLibraryFacets() {
  const live = liveWhere({
    publicationState: readingPassages.publicationState,
    publishAt: readingPassages.publishAt,
  });

  const [topics, types, totals] = await Promise.all([
    db
      .select({ topicCode: readingPassages.topicCode, value: count() })
      .from(readingPassages)
      .where(and(live, sql`${readingPassages.topicCode} is not null`))
      .groupBy(readingPassages.topicCode)
      .orderBy(desc(count())),
    db
      .select({ typeCode: readingQuestions.typeCode, value: count() })
      .from(readingQuestions)
      .innerJoin(readingPassages, eq(readingPassages.id, readingQuestions.passageId))
      .where(and(live, sql`${readingQuestions.typeCode} is not null`))
      .groupBy(readingQuestions.typeCode)
      .orderBy(desc(count())),
    db.select({ value: count() }).from(readingPassages).where(live),
  ]);

  return {
    total: Number(totals[0]?.value ?? 0),
    topics: topics
      .filter((row) => row.topicCode)
      .map((row) => ({ code: row.topicCode as string, count: Number(row.value) })),
    types: types
      .filter((row) => row.typeCode)
      .map((row) => ({ code: row.typeCode as string, count: Number(row.value) })),
  };
}

/** What the reading hub's own numbers are built from. */
export async function readingHubCounts(userId: string) {
  const [total, completed, inProgress] = await Promise.all([
    countLibrary(userId, {}),
    countLibrary(userId, { status: "completed" }),
    countLibrary(userId, { status: "in_progress" }),
  ]);
  return { total, completed, inProgress, notStarted: Math.max(0, total - completed - inProgress) };
}
