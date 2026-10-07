import "server-only";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningAttempts, listeningPackages, listeningQuestions, listeningTests } from "@/db/schema";
import { GENERAL_PRODUCT, generalProductSql, productOfPackage } from "@/lib/listening/product";
import { liveWhere } from "@/lib/services/cms/publication";
import { isUuid } from "@/lib/validation/ids";
import { listeningSchemaReady } from "./listening-schema-ready";
import type { ListeningPackage } from "@/lib/listening/package";

/**
 * GENERAL LISTENING — the catalogue of standalone SECTIONS.
 *
 * General Listening is a DIFFERENT product from Academic Listening. An Academic item is a
 * formal four-part test that opens an activity hub; a General item is ONE recording with its
 * own questions that opens DIRECTLY into the familiar Listening attempt interface. So this
 * catalogue lists sections and nothing else, and it deliberately has no hub, no combined
 * four-part exam and no per-activity cards.
 *
 * What may appear here is decided by the same ONE classifier the Academic catalogue uses
 * (`src/lib/listening/product.ts`), read as `general_section`:
 *
 *   • a revision authored through the CMS as `listening:section` — the canonical way a
 *     standalone section is created; or
 *   • a canonical package whose authored `collection` is `general`.
 *
 * Nothing is inferred from a title, from media type, or from "it has only one section":
 * a one-part Academic test stays Academic, and a five-question drill is not a section until
 * it is authored as one.
 *
 * A section must not REQUIRE a four-part test to exist (owner directive): the membership and
 * every card field here are read from the SECTION itself. `listening_packages` is optional —
 * a natively authored section has none — so the reader never joins through it as if it were
 * mandatory.
 */

/** How many General Listening sections one catalogue page shows. */
export const GENERAL_LISTENING_PAGE_SIZE = 24;

/** One bounded page of the General catalogue, plus what a reader needs to move between pages. */
export type GeneralListeningPage = {
  cards: GeneralListeningCard[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  total: number;
};

export type GeneralListeningCard = {
  testId: string;
  title: string;
  /** The authored section number (1–4), or null when the item does not state one. */
  sectionNo: number | null;
  /** How long the recording is, in seconds, when the section states it. Never invented. */
  durationSec: number | null;
  /** How many questions this section really has. */
  questionCount: number;
  /** The learner's own truth about this section: nothing is claimed before they open it. */
  started: boolean;
  completed: boolean;
  /** The attempt a learner would CONTINUE, when one is open. */
  openAttemptId: string | null;
  /** Their latest finished attempt, for an honest "last result" line. */
  lastScore: number | null;
  lastTotal: number | null;
};

/** The authored section identity: the CMS revision states it; a package may also carry it. */
const sectionNoSql = sql<number | null>`
  coalesce(
    (select nullif(v.content_snapshot->>'sectionNo', '')::int
       from content_versions v
      where v.module = 'listening' and v.content_type = 'section' and v.target_id = ${listeningTests.id}
      order by v.version_no desc
      limit 1),
    (select nullif(p.payload->'sections'->0->>'number', '')::int
       from listening_packages p
      where p.test_id = ${listeningTests.id})
  )`;

/** The authored duration, in seconds, when the section states one. */
const durationSql = sql<number | null>`
  (select nullif(p.payload->'audio'->>'durationSec', '')::int
     from listening_packages p
    where p.test_id = ${listeningTests.id})`;

/** How many questions the section really has — the question rows are the authority. */
const questionCountSql = sql<number>`(
  select count(*)::integer from listening_questions q where q.test_id = ${listeningTests.id}
)`;

export async function generalListeningCards(
  userId: string,
  page = 1,
  /** Optional executor, so a test can drive this exact read against its own real database. */
  database: typeof db = db,
): Promise<GeneralListeningPage> {
  const exec = database;
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  if (!(await listeningSchemaReady(database)))
    return { cards: [], page: safePage, pageSize: GENERAL_LISTENING_PAGE_SIZE, hasMore: false, total: 0 };

  // Membership and liveness are BOTH predicates, applied before any bound. A package is
  // OPTIONAL here: a natively authored section has no package row, and requiring one would
  // silently hide every section the centre author.
  const membership = and(
    liveWhere(listeningTests),
    generalProductSql({
      testId: sql`${listeningTests.id}`,
      payload: sql`${listeningPackages.payload}`,
      payloadIsNull: sql`${listeningPackages.payload} is null`,
    }),
  );

  const [counted] = await exec
    .select({ total: sql<number>`count(*)::integer` })
    .from(listeningTests)
    .leftJoin(listeningPackages, eq(listeningPackages.testId, listeningTests.id))
    .where(membership);
  const total = Number(counted?.total ?? 0);

  const rows = await exec
    .select({
      testId: listeningTests.id,
      title: listeningTests.title,
      sectionNo: sectionNoSql,
      durationSec: durationSql,
      questionCount: questionCountSql,
      started: sql<boolean>`exists(select 1 from listening_attempts a where a.test_id = ${listeningTests.id} and a.user_id = ${userId})`,
      completed: sql<boolean>`exists(select 1 from listening_attempts a where a.test_id = ${listeningTests.id} and a.user_id = ${userId} and a.status = 'completed')`,
      openAttemptId: sql<string | null>`(select a.id from listening_attempts a where a.test_id = ${listeningTests.id} and a.user_id = ${userId} and a.status = 'in_progress' order by a.started_at desc limit 1)`,
      lastScore: sql<number | null>`(select a.score from listening_attempts a where a.test_id = ${listeningTests.id} and a.user_id = ${userId} and a.status = 'completed' order by a.submitted_at desc nulls last limit 1)`,
      lastTotal: sql<number | null>`(select a.total_questions from listening_attempts a where a.test_id = ${listeningTests.id} and a.user_id = ${userId} and a.status = 'completed' order by a.submitted_at desc nulls last limit 1)`,
    })
    .from(listeningTests)
    .leftJoin(listeningPackages, eq(listeningPackages.testId, listeningTests.id))
    .where(membership)
    // A TOTAL order, so paging can never repeat or skip a section: the authored sequence,
    // then the authored source reference, then the row id — all three are stable.
    .orderBy(asc(listeningTests.createdAt), asc(listeningTests.sourceRef), asc(listeningTests.id))
    .limit(GENERAL_LISTENING_PAGE_SIZE)
    .offset((safePage - 1) * GENERAL_LISTENING_PAGE_SIZE);

  const cards: GeneralListeningCard[] = rows.map((row) => ({
    testId: row.testId,
    title: row.title,
    sectionNo: row.sectionNo === null ? null : Number(row.sectionNo),
    durationSec: row.durationSec === null ? null : Number(row.durationSec),
    questionCount: Number(row.questionCount ?? 0),
    started: Boolean(row.started),
    completed: Boolean(row.completed),
    openAttemptId: row.openAttemptId ?? null,
    lastScore: row.lastScore === null ? null : Number(row.lastScore),
    lastTotal: row.lastTotal === null ? null : Number(row.lastTotal),
  }));

  return {
    cards,
    page: safePage,
    pageSize: GENERAL_LISTENING_PAGE_SIZE,
    hasMore: safePage * GENERAL_LISTENING_PAGE_SIZE < total,
    total,
  };
}

/* -------------------------------------------------------------------------- */
/* ONE section, opened directly                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything the section attempt needs, or null when this test is not an OPEN standalone
 * section for this learner.
 *
 * The gate is the same decision the catalogue makes, so a URL can never open something the
 * catalogue does not list — or vice versa. A section does not need a package: when the centre
 * authored it natively, the questions come from `listening_questions` and the audio from the
 * test row itself.
 */
export async function getOpenableSection(
  testId: string,
  userId: string,
  database: typeof db = db,
): Promise<{
  test: typeof listeningTests.$inferSelect;
  /** The canonical package payload, when this section was imported rather than authored. */
  package: ListeningPackage | null;
  /** The private object key of the section's map image, when it has one. */
  imageObjectKey: string | null;
  questions: (typeof listeningQuestions.$inferSelect)[];
} | null> {
  if (!isUuid(testId)) return null;
  if (!(await listeningSchemaReady(database))) return null;
  const [row] = await database
    .select({ test: listeningTests, payload: listeningPackages.payload, imageObjectKey: listeningPackages.imageObjectKey })
    .from(listeningTests)
    .leftJoin(listeningPackages, eq(listeningPackages.testId, listeningTests.id))
    .where(and(eq(listeningTests.id, testId), liveWhere(listeningTests)))
    .limit(1);
  if (!row) return null;

  const pkg = (row.payload ?? null) as ListeningPackage | null;
  const versionResult = await database.execute<{ content_type: string | null }>(sql`
    select v.content_type from content_versions v
     where v.module = 'listening' and v.target_id = ${testId}
     order by v.version_no desc limit 1`);
  const versionType = versionResult.rows[0]?.content_type ?? null;
  const product = pkg
    ? productOfPackage(pkg, versionType)
    : versionType === "section"
      ? GENERAL_PRODUCT
      : null;
  if (product !== GENERAL_PRODUCT) return null;

  const questions = await database
    .select()
    .from(listeningQuestions)
    .where(eq(listeningQuestions.testId, testId))
    .orderBy(asc(listeningQuestions.order));
  if (!questions.length) return null;

  return { test: row.test, package: pkg, imageObjectKey: row.imageObjectKey ?? null, questions };
}

/**
 * The section number the CMS revision states, or null when the item does not state one.
 *
 * Read from `content_snapshot->>'sectionNo'` — the CANONICAL authored field — and never
 * derived from a title, a file name or a position in a list.
 */
export async function authoredSectionNumber(testId: string, database: typeof db = db): Promise<number | null> {
  if (!(await listeningSchemaReady(database))) return null;
  const result = await database.execute<{ section_no: number | null }>(sql`
    select nullif(v.content_snapshot->>'sectionNo', '')::int as section_no
      from content_versions v
     where v.module = 'listening' and v.content_type = 'section' and v.target_id = ${testId}
     order by v.version_no desc
     limit 1`);
  const value = result.rows[0]?.section_no ?? null;
  return value === null ? null : Number(value);
}

/** The learner's own attempts on one section, newest first — for the section's own status line. */
export async function sectionAttemptsForLearner(
  testId: string,
  userId: string,
  database: typeof db = db,
): Promise<{ id: string; status: string; score: number | null; total: number | null; submittedAt: Date | null }[]> {
  if (!(await listeningSchemaReady(database))) return [];
  const rows = await database
    .select({
      id: listeningAttempts.id,
      status: listeningAttempts.status,
      score: listeningAttempts.score,
      total: listeningAttempts.totalQuestions,
      submittedAt: listeningAttempts.submittedAt,
    })
    .from(listeningAttempts)
    .where(and(eq(listeningAttempts.testId, testId), eq(listeningAttempts.userId, userId)))
    .orderBy(asc(listeningAttempts.startedAt));
  return rows.map((row) => ({ ...row, status: String(row.status) }));
}

/** Exposed for the focused tests: the SQL membership this reader is built on. */
export const generalMembershipSql: SQL = generalProductSql({
  testId: sql`${listeningTests.id}`,
  payload: sql`${listeningPackages.payload}`,
  payloadIsNull: sql`${listeningPackages.payload} is null`,
});
