import "server-only";
import { and, asc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningAttempts, listeningPackages, listeningTests } from "@/db/schema";
import { ACADEMIC_PRODUCT, academicProductSql, inProgrammeSql, productSql, productOfPackage } from "@/lib/listening/product";
import { liveWhere } from "@/lib/services/cms/publication";
import { isUuid } from "@/lib/validation/ids";
import type { Role } from "@/lib/auth/roles";
import { listeningSchemaReady } from "./listening-schema-ready";
import { fullListeningDetail, listeningLearnerFacts, listeningPracticeProgress } from "./full-listening";
import {
  activityPath,
  activityFacts,
  packageActivities,
  practiceKindOf,
  type ListeningActivityId,
  type PracticeKind,
} from "@/lib/listening/activities";
import type { ListeningPackage } from "@/lib/listening/package";

/**
 * ACADEMIC LISTENING — the catalogue and the test hubs.
 *
 * Both reads come from the ONE canonical Listening layer (`listening_tests` +
 * `listening_packages`); neither invents a test table, a React-side catalogue or a title
 * convention. The difference between them is the question each answers:
 *
 *   • the CATALOGUE answers "which Academic Listening tests may I open?" — a bounded,
 *     live-only query with the collection as a WHERE clause (never a post-filter, which
 *     would let unrelated content push a real test off the page);
 *   • a HUB answers "what may I do with THIS test?" — the authored facts of the test plus
 *     what is true about this learner, handed to the activity registry
 *     (`src/lib/listening/activities.ts`). Two genuinely different tests therefore produce
 *     two genuinely different hubs, and no card is ever faked to make the grid look full.
 *
 * Collections: canonical packages record `collection` (`academic`, `essential`, `general`,
 * `question_types`, `mcq`); rows authored before that field carry none, and none means
 * "academic" — exactly the rule the existing library component applies. `question_types`
 * and `mcq` are academic-listening practice material, so they are part of this catalogue.
 * The rule lives here, once.
 */

/** How many Academic Listening tests one catalogue page shows. */
export const ACADEMIC_LISTENING_PAGE_SIZE = 24;

/**
 * WHERE THIS CATALOGUE LOGIN IS DECIDED.
 *
 * Only a formal Academic Listening FULL TEST belongs here. The owner separated this from the
 * dedicated practice products, and the rule (with its reasoning and its evidence) lives in
 * `src/lib/listening/product.ts` — ONE decision table, expressed once for the database and
 * once for a loaded payload, with an agreement test that fails if the two ever disagree.
 *
 * A dedicated MCQ package and a question-type practice package remain exactly what they are
 * (their canonical identity is NOT relabelled): they are simply not academic full tests, and
 * their own surfaces will offer them.
 */
const academicMembership = academicProductSql({
  testId: sql`${listeningTests.id}`,
  payload: sql`${listeningPackages.payload}`,
  payloadIsNull: sql`false`,
  // A programme DAY is never an Academic full test, however its package is stamped (0052).
  inProgramme: inProgrammeSql(sql`${listeningTests.programRef}`),
});

/**
 * The membership rule for ONE already-loaded package — the hub's half of the same decision
 * (`productOfPackage`), so a hub URL can never disagree with the catalogue that links to it.
 */
export function isAcademicFullTest(pkg: ListeningPackage | undefined, versionContentType?: string | null): boolean {
  return Boolean(pkg) && productOfPackage(pkg!, versionContentType) === ACADEMIC_PRODUCT;
}

/** One bounded page of the catalogue, plus what a reader needs to move between pages. */
export type AcademicListeningPage = {
  cards: AcademicListeningCard[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  total: number;
};

export type AcademicListeningCard = {
  testId: string;
  title: string;
  /** Whole-test length in minutes, rounded from the authored audio duration. */
  minutes: number | null;
  parts: number;
  questions: number;
  /** Activities this test supports for THIS learner — the number the card states. */
  activityCount: number;
  /** How many of them the learner has finished (exam once, each practice run once, MCQ once). */
  completed: number;
  started: boolean;
  /** The latest submitted exam result, when there is one. */
  exam: { score: number | null; total: number | null } | null;
  /**
   * The authored identity of the test — its `source_ref` (the reference the centre wrote
   * when it authored the test), or the content source id when it has none. The catalogue
   * never invents a "Listening Test 1..N" number and never parses a display title, so this
   * is what the ordering is anchored to (see `academicListeningCards`).
   */
  orderKey: string;
};

export type AcademicActivity = {
  id: ListeningActivityId;
  /** The route segment that runs it, under `/app/listening/tests/:id/`. */
  path: string;
  /**
   * A graded practice activity (matching / completion / map / retry), otherwise exam or study.
   * The type IS `PracticeKind` rather than a hand-copied list, so adding a practice activity to
   * the registry cannot leave this hub behind.
   */
  practice: PracticeKind | null;
  /** Has this learner finished it? */
  complete: boolean;
  /** The most recent graded result of this activity, when it has been graded at all. */
  latest: { score: number | null; total: number | null } | null;
};

export type AcademicListeningTest = {
  testId: string;
  title: string;
  minutes: number | null;
  parts: number;
  questions: number;
  /** A full transcript exists, so transcript-based work is genuinely possible. */
  transcriptAvailable: boolean;
  /** True while this is a draft being previewed by staff — learners never see it. */
  draft: boolean;
  activities: AcademicActivity[];
  progress: { completed: number; total: number; exam: { score: number | null; total: number | null } | null };
};

/**
 * Questions of this test with no correct answer in the learner's MOST RECENT submitted
 * attempt — wrongly answered or left blank. Zero when the learner has never submitted, so
 * "Retry Weak Areas" can never appear for someone with nothing to retry.
 */
function missedInLatestAttempt(testIdColumn: AnyColumn | SQL, userId: string) {
  return sql<number>`case when exists(
    select 1 from listening_attempts a
    where a.test_id = ${testIdColumn} and a.user_id = ${userId} and a.status = 'completed'
  ) then (
    select count(*)::integer from listening_questions q
    where q.test_id = ${testIdColumn}
      and not exists (
        select 1 from listening_answers ans
        where ans.question_id = q.id
          and ans.is_correct = true
          and ans.attempt_id = (
            select a.id from listening_attempts a
            where a.test_id = ${testIdColumn} and a.user_id = ${userId} and a.status = 'completed'
            order by a.submitted_at desc nulls last
            limit 1
          )
      )
  ) else 0 end`;
}

/** Every MCQ of this test is staged and reasoned by this learner. */
function mcqCompleteSql(testIdColumn: AnyColumn | SQL, userId: string) {
  return sql<boolean>`exists(select 1 from listening_questions q where q.test_id = ${testIdColumn} and q.type = 'multiple_choice') and not exists(
    select 1 from listening_questions q
    where q.test_id = ${testIdColumn} and q.type = 'multiple_choice'
      and not exists (select 1 from listening_mcq_sessions s where s.question_id = q.id and s.user_id = ${userId} and s.stage = 'reasoned')
  )`;
}

/**
 * The published academic catalogue for one learner.
 *
 * Bounded on purpose: one screenful of canonical tests, the same cap for everybody, so the
 * page cannot degrade as the centre authors more.
 *
 * ORDERING — the repository is the evidence here, and it says this plainly: `listening_tests`
 * has no position, number or sequence column, so there is no authored ordering field to read
 * (and none was invented for this page). What is authored and stable is WHEN the centre
 * imported each test, so the catalogue is ordered by `created_at` ascending — the sequence in
 * which the tests were authored — with the authored `source_ref` as a deterministic tiebreak
 * for two rows that share a timestamp. The display title is never parsed, and the order is
 * NOT a numeric reading of the source reference: `cam18-test10` sorts after `cam18-test2`
 * only because it was authored later, not because a regular expression said so. If the centre
 * ever needs an order that differs from import order, that is an authored position column —
 * a migration decision to be taken with the owner, not something to be guessed at read time.
 */
export async function academicListeningCards(
  userId: string,
  page = 1,
  /** Optional executor, so a test can drive this exact read against its own real database. */
  database: typeof db = db,
): Promise<AcademicListeningPage> {
  const exec = database;
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  if (!(await listeningSchemaReady(database))) return { cards: [], page: safePage, pageSize: ACADEMIC_LISTENING_PAGE_SIZE, hasMore: false, total: 0 };

  // The membership test and the live-publication test are BOTH predicates, applied before any
  // bound — never a post-filter on an unrelated cap, which is how a legitimate test disappears
  // behind newer content on a later page.
  const membership = and(liveWhere(listeningTests), academicMembership);
  const [counted] = await exec.select({ total: sql<number>`count(*)::integer` }).from(listeningPackages).innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId)).where(membership);
  const total = Number(counted?.total ?? 0);

  const rows = await exec
    .select({
      testId: listeningTests.id,
      title: listeningTests.title,
      sourceRef: listeningTests.sourceRef,
      sourceId: listeningPackages.sourceId,
      // Seconds, so the ONE `minutesOf` helper below is the only place that converts.
      durationSec: sql<number | null>`(${listeningPackages.payload}->'audio'->>'durationSec')::real`,
      parts: sql<number>`coalesce(jsonb_array_length(${listeningPackages.payload}->'sections'), 0)`,
      questions: sql<number>`coalesce(jsonb_array_length(${listeningPackages.payload}->'questions'), 0)`,
      payload: listeningPackages.payload,
      examSubmitted: sql<boolean>`exists(select 1 from listening_attempts a where a.test_id = ${listeningTests.id} and a.user_id = ${userId} and a.status = 'completed')`,
      examScore: sql<number | null>`(select a.score from listening_attempts a where a.test_id = ${listeningTests.id} and a.user_id = ${userId} and a.status = 'completed' order by a.submitted_at desc nulls last limit 1)`,
      examTotal: sql<number | null>`(select a.total_questions from listening_attempts a where a.test_id = ${listeningTests.id} and a.user_id = ${userId} and a.status = 'completed' order by a.submitted_at desc nulls last limit 1)`,
      started: sql<boolean>`exists(select 1 from listening_attempts a where a.test_id = ${listeningTests.id} and a.user_id = ${userId})`,
      // Practice runs are the existing, explicitly scoped drill rows (`_practice` marker);
      // speed-study rows are not a graded activity and never count as one.
      practiceRuns: sql<number>`(select count(distinct (r.activity::text || coalesce(r.answers->>'_practice','')))::integer from listening_activity_runs r where r.test_id = ${listeningTests.id} and r.user_id = ${userId} and r.completed = true and r.speed_rate is null and r.answers->>'_practice' is not null)`,
      mcqComplete: mcqCompleteSql(listeningTests.id, userId),
      missed: missedInLatestAttempt(listeningTests.id, userId),
    })
    .from(listeningPackages)
    .innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId))
    .where(membership)
    // A TOTAL order, so paging can never repeat or skip a test: the authored sequence, then
    // the authored source reference, then the row id — all three are stable.
    .orderBy(asc(listeningTests.createdAt), asc(listeningTests.sourceRef), asc(listeningTests.id))
    .limit(ACADEMIC_LISTENING_PAGE_SIZE)
    .offset((safePage - 1) * ACADEMIC_LISTENING_PAGE_SIZE);

  const cards = rows.map((row) => {
    const payload = row.payload as ListeningPackage;
    const examSubmitted = Boolean(row.examSubmitted);
    const activities = packageActivities(payload, { examSubmitted, missedQuestions: Number(row.missed ?? 0) });
    const examDone = examSubmitted && activities.includes("exam") ? 1 : 0;
    const mcqDone = activities.includes("mcq") && Boolean(row.mcqComplete) ? 1 : 0;
    return {
      testId: row.testId,
      title: row.title,
      minutes: minutesOf(row.durationSec),
      parts: Number(row.parts),
      questions: Number(row.questions),
      activityCount: activities.length,
      completed: Math.min(activities.length, examDone + Number(row.practiceRuns ?? 0) + mcqDone),
      started: Boolean(row.started),
      exam: examSubmitted ? { score: row.examScore ?? null, total: row.examTotal ?? null } : null,
      orderKey: row.sourceRef ?? row.sourceId,
    };
  });

  return { cards, page: safePage, pageSize: ACADEMIC_LISTENING_PAGE_SIZE, hasMore: safePage * ACADEMIC_LISTENING_PAGE_SIZE < total, total };
}

function minutesOf(seconds: number | null): number | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null;
}

/**
 * Is this test id offered by THIS catalogue? The catalogue's own membership expression,
 * evaluated for one row — the hub gate and the listing can never drift apart.
 */
async function isAcademicListing(testId: string, database: typeof db = db): Promise<boolean> {
  if (!(await listeningSchemaReady(database))) return false;
  const [row] = await database
    .select({
      product: productSql({
        testId: sql`${listeningTests.id}`,
        payload: sql`${listeningPackages.payload}`,
        payloadIsNull: sql`false`,
        inProgramme: inProgrammeSql(sql`${listeningTests.programRef}`),
      }),
    })
    .from(listeningPackages)
    .innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId))
    .where(eq(listeningPackages.testId, testId))
    .limit(1);
  return row?.product === ACADEMIC_PRODUCT;
}

/**
 * ONE test hub.
 *
 * Returns null for an unknown id, for a non-live test read by a learner, and for anything
 * that is not a uuid — one answer, no information leak, exactly like the learner lesson
 * pages and the existing full-listening detail read, which this reuses rather than
 * re-implements.
 */
export async function academicListeningTest(
  testId: string,
  user: { id: string; role: Role },
  database: typeof db = db,
): Promise<AcademicListeningTest | null> {
  const exec = database;
  // A malformed id is not a database question: it is answered before any query, exactly as
  // the learner lesson pages do, so a probe cannot reach the planner at all.
  if (!isUuid(testId)) return null;
  const detail = await fullListeningDetail(testId, user.role, database);
  if (!detail) return null;
  const payload = detail.pkg.payload;
  // A8 — the SAME decision the catalogue used, asked of the SAME expression rather than
  // re-implemented: a hub URL can therefore never disagree with the listing that linked to it.
  if (!(await isAcademicListing(testId, database))) return null;
  // ONE source of learner truth, shared with the generic hub.
  const { examSubmitted, missedQuestions, progress } = await listeningLearnerFacts(user.id, testId, database);
  const practice = await listeningPracticeProgress(user.id, testId, database);

  const activities = packageActivities(payload, { examSubmitted, missedQuestions }).map((id) => {
    const kind = practiceKindOf(id);
    const run = kind ? practice[kind] : undefined;
    const legacy = progress.activities.find((entry) => String(entry.activity) === activityPath[id]);
    // The displayed grade comes from the last COMPLETED run, not simply the newest one:
    // starting a fresh attempt and abandoning it must not blank a result the learner
    // already earned. `run.latest` remains what the activity page resumes from.
    const gradedRun = run?.latestCompleted ?? null;
    const graded = gradedRun
      ? { score: gradedRun.score ?? null, total: gradedRun.total ?? null }
      : legacy?.latest
        ? { score: legacy.latest.score ?? null, total: legacy.latest.total ?? null }
        : null;
    return {
      id,
      path: activityPath[id]!,
      practice: kind,
      complete: id === "exam" ? Boolean(progress.exam) : (run?.complete ?? legacy?.complete ?? false),
      latest: graded,
    } satisfies AcademicActivity;
  });

  const facts = activityFacts(payload);
  return {
    testId: detail.test.id,
    title: detail.test.title,
    minutes: minutesOf(payload.audio.durationSec),
    parts: payload.sections.length,
    questions: payload.questions.length,
    transcriptAvailable: facts.transcript,
    draft: detail.test.publicationState !== "published",
    activities,
    progress: {
      completed: activities.filter((activity) => activity.complete).length,
      total: activities.length,
      exam: progress.exam ? { score: progress.exam.score ?? null, total: progress.exam.total ?? null } : null,
    },
  };
}
