import "server-only";
import { and, asc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningAttempts, listeningPackages, listeningQuestions, listeningTests } from "@/db/schema";
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

/** The most tests one academic catalogue page shows. */
export const ACADEMIC_LISTENING_PAGE_MAX = 60;

/** `coalesce(payload->>'collection','academic') in ('academic','question_types','mcq')`. */
const academicCollection = sql`coalesce(${listeningPackages.payload}->>'collection', 'academic') in ('academic','question_types','mcq')`;

/**
 * The same membership rule in TypeScript, so the catalogue and a test hub can never disagree
 * about whether a test belongs here: a hub URL for a test the catalogue does not list (an
 * Essential recording, or a General Listening test which will get its own catalogue) is not
 * a hub of THIS catalogue.
 */
export function isAcademicCollection(collection: string | undefined): boolean {
  const value = collection ?? "academic";
  return value === "academic" || value === "question_types" || value === "mcq";
}

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
  /** A graded practice activity (matching / completion / retry), otherwise exam or study. */
  practice: "matching" | "completion" | "retry" | null;
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
  limit = ACADEMIC_LISTENING_PAGE_MAX,
  /** Optional executor, so a test can drive this exact read against its own real database. */
  database: typeof db = db,
): Promise<AcademicListeningCard[]> {
  const exec = database;
  if (!(await listeningSchemaReady(database))) return [];
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
    .where(and(liveWhere(listeningTests), academicCollection))
    .orderBy(asc(listeningTests.createdAt), asc(listeningTests.sourceRef))
    .limit(Math.max(1, Math.min(limit, ACADEMIC_LISTENING_PAGE_MAX)));

  return rows.map((row) => {
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
}

function minutesOf(seconds: number | null): number | null {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null;
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
  if (!isAcademicCollection(payload.collection)) return null;
  // ONE source of learner truth, shared with the generic hub.
  const { examSubmitted, missedQuestions, progress } = await listeningLearnerFacts(user.id, testId, database);
  const practice = await listeningPracticeProgress(user.id, testId, database);

  const activities = packageActivities(payload, { examSubmitted, missedQuestions }).map((id) => {
    const kind = practiceKindOf(id);
    const run = kind ? practice[kind] : undefined;
    const legacy = progress.activities.find((entry) => String(entry.activity) === activityPath[id]);
    const graded = run?.latest
      ? { score: run.latest.score ?? null, total: run.latest.total ?? null }
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
