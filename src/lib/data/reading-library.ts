import { activateReadingSchedules } from "@/lib/services/reading/schedules";
import { readingCanonicalTypeSql } from "@/lib/data/reading-type-index";
import { readingQuestionType } from "@/lib/reading/question-model";
import { and, asc, count, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts, readingPassages, readingQuestions } from "@/db/schema";
import { liveWhere } from "@/lib/services/cms/publication";
import { academicOnlyClause } from "@/lib/data/general-reading";
import { timed } from "@/lib/observability/timing";

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
 *
 * ---------------------------------------------------------------------------
 * Round trips
 * ---------------------------------------------------------------------------
 * The hub used to open `/app/reading` with twelve queries in five sequential waves,
 * one of them a full scan of `reading_questions` grouped by passage just to
 * place a number on twenty-four cards. Against a database next door that is
 * invisible; against one 250 ms away it is a page the owner experiences as a
 * freeze, and every extra query in flight is another connection held from a
 * limited pool. After identity, hub counts, facets and the page of cards now
 * start concurrently; only the attempt states depend on the returned card ids.
 * The shell's unread count runs independently of the page's content queries.
 *
 * The two numbers that used to cost a query each are now read from the rows
 * already being returned: the total comes from `count(*) over ()` on the same
 * statement as the page, and each card's question count is a correlated
 * subquery on the same row — no full-table grouping, and the filter count the
 * page displays is the very count the query itself used, so the two can no
 * longer disagree.
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
  setId?: string;
  questionTypes?: string[];
  difficultyLevel?: string;
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

/** The publication window: a draft, an archive or a not-yet-due schedule is invisible. */
async function liveClause() {
  await activateReadingSchedules();
  // The Academic library: live AND not a General Reading (learning) passage (0030).
  return and(liveWhere({
    publicationState: readingPassages.publicationState,
    publishAt: readingPassages.publishAt,
  }), await academicOnlyClause());
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
async function libraryWhere(userId: string, filter: ReadingLibraryFilter) {
  const clauses = [await liveClause()];

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

/** How many passages each filter state would show. */
export async function countLibrary(userId: string, filter: ReadingLibraryFilter = {}) {
  return timed("reading.count", async () => {
    const rows = await db
      .select({ value: count() })
      .from(readingPassages)
      .where(await libraryWhere(userId, filter));
    return Number(rows[0]?.value ?? 0);
  });
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
  const where = await libraryWhere(userId, filter);
  const requestedPage = Math.max(1, Math.floor(filter.page ?? 1));

  const fetchPage = (page: number) =>
    db
      .select({
        id: readingPassages.id,
        title: readingPassages.title,
        testNo: readingPassages.testNo,
        passageNo: readingPassages.passageNo,
        topicCode: readingPassages.topicCode,
        suggestedMinutes: readingPassages.suggestedMinutes,
        // One number per card, read on the row it belongs to.
        // Drizzle strips Column qualifiers in a single-table SELECT projection.
        // Keep this correlated outer reference explicit, or it becomes q.id.
        questionCount: sql<number>`(select count(*) from ${readingQuestions} q where q.passage_id = "reading_passages"."id")`,
        // The total before LIMIT, on the same statement as the rows.
        total: sql<number>`count(*) over ()`,
      })
      .from(readingPassages)
      .where(where)
      .orderBy(asc(readingPassages.testNo), asc(readingPassages.passageNo), asc(readingPassages.title), asc(readingPassages.id))
      .limit(READING_PAGE_SIZE)
      .offset((page - 1) * READING_PAGE_SIZE);

  const { passages, total, page } = await timed("reading.list", async () => {
    let currentPage = requestedPage;
    let rows = await fetchPage(currentPage);
    let totalRows = Number(rows[0]?.total ?? 0);

    /*
     * A page past the end — a stale bookmark, or a filter that shrank the list
     * while the URL still said `page=5`. The row window carries no total when it
     * is empty, so this is the one case that pays for a count query; the page
     * then lands on the last real page, exactly as it did before.
     */
    if (rows.length === 0 && currentPage > 1) {
      totalRows = await countLibrary(userId, filter);
      const lastPage = Math.max(1, Math.ceil(totalRows / READING_PAGE_SIZE));
      if (lastPage !== currentPage) {
        currentPage = Math.min(currentPage, lastPage);
        rows = await fetchPage(currentPage);
      }
    }

    return { passages: rows, total: totalRows, page: currentPage };
  });

  const ids = passages.map((passage) => passage.id);
  const attempts = await timed("reading.attempts", async () =>
    ids.length
      ? db
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
      : []
  );

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
      questionCount: Number(passage.questionCount ?? 0),
      suggestedMinutes: passage.suggestedMinutes,
      status,
      lastScore: latest?.status === "completed" ? latest.score : null,
      lastAttemptId: latest && latest.status === "in_progress" ? latest.id : null,
    };
  });

  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / READING_PAGE_SIZE)) };
}

/**
 * The values a student can filter by, taken from the library itself.
 *
 * Nothing is hard-coded: if a topic or question type is not present in the
 * published library it does not appear in the dropdown, so a filter can never
 * lead to an empty screen. The library total is *not* counted here — the hub
 * already knows it, and asking twice was one of the round trips that made the
 * page slow.
 */
export async function listLibraryFacets(learning = false, executor: typeof db = db) {
  await activateReadingSchedules(executor);
  return timed("reading.facets", async () => {
    const live = learning ? and(liveWhere({publicationState:readingPassages.publicationState,publishAt:readingPassages.publishAt}),sql`exists(select 1 from general_reading_passages g join general_reading_sets s on s.id=g.set_id where g.passage_id=${readingPassages.id} and (s.publication_state='published' or (s.publication_state='scheduled' and s.publish_at<=now())))`) : await liveClause();

    // General uses the same canonical types as its cards and type-filter query.
    // Count passages once even when a type appears in multiple question groups.
    const [topics, types] = await Promise.all([
      executor
        .select({ topicCode: readingPassages.topicCode, value: count() })
        .from(readingPassages)
        .where(and(live, sql`${readingPassages.topicCode} is not null`))
        .groupBy(readingPassages.topicCode)
        .orderBy(desc(count())),
      learning ? executor.execute<{typeCode:string|null;value:number}>(sql`
        select ${readingCanonicalTypeSql()} as "typeCode", count(distinct ${readingPassages.id})::int as value
        from ${readingQuestions} q join ${readingPassages} on ${readingPassages.id}=q.passage_id
        where ${live} group by 1 order by count(distinct ${readingPassages.id}) desc
      `).then(result=>result.rows) : executor
        .select({ typeCode: readingQuestions.typeCode, value: count() })
        .from(readingQuestions)
        .innerJoin(readingPassages, eq(readingPassages.id, readingQuestions.passageId))
        .where(and(live, sql`${readingQuestions.typeCode} is not null`))
        .groupBy(readingQuestions.typeCode)
        .orderBy(desc(count())),
    ]);

    return {
      topics: topics
        .filter((row) => row.topicCode)
        .map((row) => ({ code: row.topicCode as string, count: Number(row.value) })),
      types: types
        .filter((row) => row.typeCode)
        .map((row) => ({ code: row.typeCode as string, count: Number(row.value) })),
    };
  });
}

/**
 * What the reading hub's own numbers are built from.
 *
 * Total, finished and in-progress are three answers to the same question — "how
 * many published passages match this student's state?" — so they are asked once,
 * as three filtered counts over one scan, instead of three separate statements
 * competing for connections.
 */
export async function readingHubCounts(userId: string) {
  return timed("reading.hubCounts", async () => {
    const rows = await db
      .select({
        total: count(),
        completed: sql<number>`count(*) filter (where exists (select 1 from ${readingAttempts} a
                                 where a.passage_id = "reading_passages"."id" and a.user_id = ${userId} and a.status = 'completed'))`,
        inProgress: sql<number>`count(*) filter (where exists (select 1 from ${readingAttempts} a
                                   where a.passage_id = "reading_passages"."id" and a.user_id = ${userId} and a.status = 'in_progress'))`,
      })
      .from(readingPassages)
      .where(await liveClause());

    const total = Number(rows[0]?.total ?? 0);
    const completed = Number(rows[0]?.completed ?? 0);
    const inProgress = Number(rows[0]?.inProgress ?? 0);
    return { total, completed, inProgress, notStarted: Math.max(0, total - completed - inProgress) };
  });
}

/** General learning cards use the same published passages as full Academic sets,
 * but read per-passage learning progress and always link into the General session. */
export async function listLearningLibrary(userId: string, filter: ReadingLibraryFilter = {}, executor: typeof db = db) {
  await activateReadingSchedules(executor);
  const clauses = [sql`(p.publication_state='published' or (p.publication_state='scheduled' and p.publish_at<=now()))`,sql`(s.publication_state='published' or (s.publication_state='scheduled' and s.publish_at<=now()))`];
  const number = {passage1:1,passage2:2,passage3:3}[filter.status ?? ""];
  if(number)clauses.push(sql`g.passage_no=${number}`);
  if(text(filter.query))clauses.push(sql`p.title ilike ${`%${text(filter.query)!.replace(/[%_\\]/g,m=>"\\"+m)}%`}`);
  if(text(filter.topic))clauses.push(sql`p.topic_code=${text(filter.topic)}`);
  if(text(filter.type)) {
    const canonical=readingQuestionType(text(filter.type)!);
    clauses.push(canonical ? sql`exists(select 1 from reading_questions q where q.passage_id=p.id and ${readingCanonicalTypeSql()}=${canonical.id})` : sql`exists(select 1 from reading_questions q where q.passage_id=p.id and q.type_code=${text(filter.type)})`);
  }
  if(filter.status==='completed')clauses.push(sql`r.checked_at is not null`);
  if(filter.status==='in_progress')clauses.push(sql`r.passage_id is not null and r.checked_at is null`);
  if(filter.status==='not_started')clauses.push(sql`r.passage_id is null`);
  const from=sql`from general_reading_passages g join general_reading_sets s on s.id=g.set_id join reading_passages p on p.id=g.passage_id left join general_reading_progress r on r.passage_id=p.id and r.user_id=${userId}::uuid where ${sql.join(clauses,sql` and `)}`;
  const result=await executor.execute<{id:string;title:string;test_no:number|null;passage_no:number;topic_code:string|null;suggested_minutes:number;set_id:string;question_count:number;question_types:string[];difficulty_level:string;score:number|null;checked_at:string|null;started:boolean}>(sql`select p.id,p.title,p.test_no,g.passage_no,p.topic_code,p.suggested_minutes,g.set_id,p.difficulty_level,(select array_agg(distinct ${readingCanonicalTypeSql()}) from reading_questions q where q.passage_id=p.id) question_types,(select count(*)::int from reading_questions q where q.passage_id=p.id) question_count,r.score,r.checked_at,r.passage_id is not null as started ${from} order by p.test_no asc nulls last,case when p.test_no is null then p.external_id end asc nulls last,s.created_at,s.id,g.passage_no,p.id`);
  const items=result.rows.map(row=>({id:row.id,title:row.title,testNo:row.test_no,passageNo:row.passage_no,topicCode:row.topic_code,suggestedMinutes:row.suggested_minutes,questionCount:row.question_count,status:row.checked_at?'completed' as const:row.started?'in_progress' as const:'not_started' as const,lastScore:row.checked_at?row.score:null,lastAttemptId:null,setId:row.set_id,questionTypes:(row.question_types??[]).filter(Boolean),difficultyLevel:row.difficulty_level}));
  return {items,total:items.length,page:1,pageCount:1};
}
