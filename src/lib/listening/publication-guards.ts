import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningPackages, listeningTests } from "@/db/schema";
import { listeningSchemaReady } from "@/lib/data/listening-schema-ready";
import { listeningQuestionsForLiveTest } from "./question-set";
import { MCQ_DAY_QUESTION_COUNT, isMcqDayRow, mcqDayProblems } from "./mcq-program";

/**
 * WHY A PROGRAMME DAY MAY NOT BE PUBLISHED YET — the owner's rule, enforced where publication is
 * decided.
 *
 * The rule is one sentence: a learner-visible DAY holds EXACTLY five valid multiple-choice questions.
 * A draft may hold none, three, or five while staff are authoring; PUBLICATION is where the promise
 * to the learner is made, so a four-question day is refused (the missing question is not invented), a
 * six-question day is refused (the extra one is not dropped), a question that is not genuinely
 * multiple choice is refused, a question with no key is refused, and a day with no recording is
 * refused — five questions a learner cannot hear are not a day.
 *
 * It applies to PROGRAMME DAYS ONLY. An Academic full test and a General section keep exactly the
 * publication rules they have today; nothing here can change their verdict.
 */

export type McqDayPublicationBlock = {
  /** The machine-readable refusal, so a staff surface can render its own localized headline. */
  error: "incomplete_mcq_day";
  /** The authored shape: how many questions a published day holds. */
  required: number;
  /** How many of this day's questions are complete and valid right now. */
  present: number;
  /** What is wrong, in sentences a member of staff can act on. */
  issues: string[];
};

/**
 * The refusal, or null when the day is publishable (or when the item is not a programme day at all,
 * in which case this module has no opinion).
 */
export async function mcqDayPublicationBlock(
  testId: string,
  database: typeof db = db,
): Promise<McqDayPublicationBlock | null> {
  if (!(await listeningSchemaReady(database))) return null;

  const [row] = await database
    .select({
      id: listeningTests.id,
      programRef: listeningTests.programRef,
      programOrdinal: listeningTests.programOrdinal,
      audioUrl: listeningTests.audioUrl,
    })
    .from(listeningTests)
    .where(eq(listeningTests.id, testId))
    .limit(1);
  // Not a programme day — including every row written before 0052 — so nothing changes for it.
  if (!row || !isMcqDayRow({ programRef: row.programRef, programOrdinal: row.programOrdinal })) return null;

  // The same resolver the learner's drill uses: a day is judged on the questions a learner starting
  // now would actually be given, not on a superseded revision's leftovers.
  const questions = await listeningQuestionsForLiveTest(testId, database);
  const problems = mcqDayProblems(
    questions.map((question) => ({
      number: question.order,
      typeCode: question.typeCode,
      storageType: question.type,
      options: question.options,
      correctAnswer: question.correctAnswer,
      questionText: question.questionText,
    })),
  );

  /* A day a learner cannot hear is not a day: the recording comes from the item's own audio or from
   * the private object the item's package uploaded, never from a URL assembled out of a title. */
  const [pkg] = await database
    .select({ audioObjectKey: listeningPackages.audioObjectKey })
    .from(listeningPackages)
    .where(eq(listeningPackages.testId, testId))
    .limit(1);
  if (!row.audioUrl?.trim() && !pkg?.audioObjectKey)
    problems.push({ message: "This day has no recording, so a learner would have nothing to listen to." });

  if (!problems.length) return null;

  // How many questions are complete and valid: the number the staff surface states next to the
  // rule. A question that has its own problem is not counted as valid.
  const broken = new Set(problems.filter((problem) => problem.question !== undefined).map((problem) => problem.question));
  const present = questions.filter((question) => !broken.has(question.order)).length;

  return {
    error: "incomplete_mcq_day",
    required: MCQ_DAY_QUESTION_COUNT,
    present,
    issues: problems.map((problem) => problem.message),
  };
}
