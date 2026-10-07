import "server-only";
import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningMcqSessions, listeningTests } from "@/db/schema";
import { isLive, liveWhere } from "@/lib/services/cms/publication";
import { isStaff, type Role } from "@/lib/auth/roles";
import { listeningSchemaReady } from "@/lib/data/listening-schema-ready";
import { listeningQuestionsForLiveTest } from "@/lib/listening/question-set";
import {
  MCQ_PROGRAM_REF,
  mcqDayStates,
  mcqDayStatus,
  mcqProgramProgress,
  type McqDayStatus,
} from "@/lib/listening/mcq-program";

/**
 * THE DEDICATED MCQ PROGRAMME — its catalogue and ONE day, for ONE learner.
 *
 * Two products must never be confused here. This is NOT the Academic catalogue (full tests) and NOT
 * the General catalogue (standalone sections): a day is selected by its programme relation and its
 * explicit ordinal, never by a collection, a title or a question count. A row that is not part of
 * the programme is invisible to every read in this file, which is what keeps the MCQ activity inside
 * an Academic test out of the programme (§46) and a General section's five MCQs out of it too (§47).
 *
 * The learner's staged work is read from `listening_mcq_sessions` — the EXISTING table, one row per
 * (learner, question). Day status is DERIVED from those rows, so there is no second progress record
 * to keep in step and no history to migrate.
 */

/**
 * A runaway guard, not a pagination scheme: the programme is authored as thirty days, so this
 * bound cannot cut honest content. It exists so a malformed catalogue can never stream an
 * unbounded result set into a page.
 */
const MCQ_DAY_READ_LIMIT = 200;

/**
 * Is migration 0052's programme relation present?
 *
 * The columns are additive and a deployment applies migrations in order, but a QA database may
 * deliberately lag (`scripts/preview-qa-migrate.mjs` keeps an approved-pending list). Reading a
 * column that does not exist yet would be a 500 for a learner, so this asks the catalogue first and
 * the programme reads answer "nothing yet" — the same idiom `listeningSchemaReady` uses for tables.
 */
async function mcqProgramReady(database: typeof db): Promise<boolean> {
  const result = await database.execute(
    sql`select exists (select 1 from information_schema.columns where table_name = 'listening_tests' and column_name = 'program_ref') as ready`,
  );
  return result.rows[0]?.ready === true;
}

export type McqDayCard = {
  /** The authored day number, stored on the row — never parsed from a title. */
  day: number;
  testId: string;
  title: string;
  questionCount: number;
  status: McqDayStatus;
  /** Not live: only staff previewing the programme see this card, and it says so. */
  draft: boolean;
};

export type McqProgramPage = {
  days: McqDayCard[];
  progress: ReturnType<typeof mcqProgramProgress>;
};

/** Membership is the authored relation, and a day carries a real ordinal. */
function programMembership(): SQL {
  return and(
    eq(listeningTests.programRef, MCQ_PROGRAM_REF),
    sql`${listeningTests.programOrdinal} is not null`,
  ) as SQL;
}

/**
 * The learner's programme home: every PUBLISHED day, in authored order, with that learner's own
 * status.
 *
 * The day list is what exists — a target of thirty with eight published days lists eight, because a
 * learner must never be shown a day that has no content. Staff may pass `includeDrafts` to see what
 * is being prepared, which is the only difference between the two reads.
 */
export async function mcqProgramDays(
  user: { id: string; role: Role },
  options: { includeDrafts?: boolean } = {},
  database: typeof db = db,
): Promise<McqProgramPage> {
  const empty: McqProgramPage = {
    days: [],
    progress: mcqProgramProgress({ publishedDays: 0, completedDays: 0, completedQuestions: 0 }),
  };
  if (!(await listeningSchemaReady(database))) return empty;
  if (!(await mcqProgramReady(database))) return empty;

  const staff = options.includeDrafts === true && isStaff(user.role);
  const live = liveWhere(listeningTests);
  const visibleWhere = staff ? programMembership() : (and(programMembership(), live) as SQL);

  const [rows, [publishedCount]] = await Promise.all([
    database
      .select({
        testId: listeningTests.id,
        title: listeningTests.title,
        day: listeningTests.programOrdinal,
        publicationState: listeningTests.publicationState,
        publishAt: listeningTests.publishAt,
      })
      .from(listeningTests)
      .where(visibleWhere)
      // The AUTHORED day order: the stored ordinal, ascending. Not created_at, not a title.
      .orderBy(asc(listeningTests.programOrdinal))
      .limit(MCQ_DAY_READ_LIMIT),
    // How many days are really published — the headline number, counted in SQL so it can never be
    // an artefact of what this page happened to read or of a draft a member of staff previewed.
    database.select({ total: count() }).from(listeningTests).where(and(programMembership(), live) as SQL),
  ]);

  const days = rows.filter((row) => row.day !== null);
  if (!days.length)
    return { ...empty, progress: mcqProgramProgress({ publishedDays: Number(publishedCount?.total ?? 0), completedDays: 0, completedQuestions: 0 }) };

  // One resolver, the same one the drill uses: the LIVE set of each day, so a card can never state
  // questions a learner would not be given.
  const [questionSets, sessionRows] = await Promise.all([
    Promise.all(days.map((row) => listeningQuestionsForLiveTest(row.testId, database))),
    database
      .select({
        testId: listeningMcqSessions.testId,
        questionId: listeningMcqSessions.questionId,
        stage: listeningMcqSessions.stage,
      })
      .from(listeningMcqSessions)
      .where(
        and(
          eq(listeningMcqSessions.userId, user.id),
          inArray(
            listeningMcqSessions.testId,
            days.map((row) => row.testId),
          ),
        ),
      ),
  ]);

  let completedDays = 0;
  let completedQuestions = 0;
  const cards: McqDayCard[] = days.map((row, index) => {
    const questions = questionSets[index] ?? [];
    const sessions = sessionRows.filter((session) => session.testId === row.testId);
    const status = mcqDayStatus(mcqDayStates(questions.map((question) => question.id), sessions));
    // Completion is counted for live days only: a draft a member of staff peeked at is not a day the
    // learner completed, and the learner-facing number must not move because of a preview.
    if (isLive(row)) {
      if (status.state === "completed") completedDays += 1;
      completedQuestions += status.completed;
    }
    return {
      day: Number(row.day),
      testId: row.testId,
      title: row.title,
      questionCount: questions.length,
      status,
      draft: !isLive(row),
    };
  });

  return {
    days: cards,
    progress: mcqProgramProgress({
      publishedDays: Number(publishedCount?.total ?? 0),
      completedDays,
      completedQuestions,
    }),
  };
}

export type McqDayQuestionView = {
  id: string;
  /** The item's own authored position — the ONE ordering truth the drill walks. */
  order: number;
  questionText: string;
  /** The learner's persisted stage, or null when they have never opened this question. */
  stage: string | null;
};

export type McqDayView = {
  day: number;
  testId: string;
  title: string;
  audioUrl: string | null;
  /** In the item's authored order (1…5), exactly as stored. */
  questions: McqDayQuestionView[];
  status: McqDayStatus;
  /** True while the day is not live: only staff see this, and it is labelled as a draft. */
  draft: boolean;
};

/**
 * ONE day for ONE learner — or null when it is not published (unless staff are previewing).
 *
 * The questions come from the LIVE set and are ordered by the item's own `order`, which IS the
 * learner's sequence: positions 1…5 are the authored training order, and nothing here re-sorts them.
 */
export async function mcqDayFor(
  ordinal: number,
  user: { id: string; role: Role },
  options: { includeDrafts?: boolean } = {},
  database: typeof db = db,
): Promise<McqDayView | null> {
  if (!Number.isInteger(ordinal) || ordinal < 1) return null;
  if (!(await listeningSchemaReady(database))) return null;
  if (!(await mcqProgramReady(database))) return null;

  const [row] = await database
    .select({
      testId: listeningTests.id,
      title: listeningTests.title,
      audioUrl: listeningTests.audioUrl,
      day: listeningTests.programOrdinal,
      publicationState: listeningTests.publicationState,
      publishAt: listeningTests.publishAt,
    })
    .from(listeningTests)
    .where(and(programMembership(), eq(listeningTests.programOrdinal, ordinal)))
    .limit(1);
  if (!row || row.day === null) return null;

  const staff = options.includeDrafts === true && isStaff(user.role);
  const draft = !isLive(row);
  if (draft && !staff) return null;

  const questions = await listeningQuestionsForLiveTest(row.testId, database);
  const sessions = await database
    .select({ questionId: listeningMcqSessions.questionId, stage: listeningMcqSessions.stage })
    .from(listeningMcqSessions)
    .where(and(eq(listeningMcqSessions.userId, user.id), eq(listeningMcqSessions.testId, row.testId)));

  const states = mcqDayStates(
    questions.map((question) => question.id),
    sessions,
  );

  return {
    day: Number(row.day),
    testId: row.testId,
    title: row.title,
    audioUrl: row.audioUrl,
    questions: questions.map((question, index) => ({
      id: question.id,
      order: question.order,
      questionText: question.questionText,
      stage: states[index]?.stage ?? null,
    })),
    status: mcqDayStatus(states),
    draft,
  };
}
