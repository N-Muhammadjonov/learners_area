import { mcqKeyOptions } from "./mcq-choice";
import { listeningQuestionIdentity } from "./question-identity";

/**
 * THE DEDICATED MCQ PROGRAMME — DAYS, AND WHAT MAKES ONE PUBLISHABLE.
 *
 * The owner's fourth Listening destination is a 30-day MCQ training programme: DAY 1 → DAY 30,
 * EXACTLY five multiple-choice questions per day, 150 in total. It is NOT an Academic full test,
 * NOT a General section, and NOT the MCQ card inside one test — those three keep their own
 * products, and this module deliberately shares nothing with their classification.
 *
 * WHAT A DAY IS (the architecture decision, made against repository truth rather than in advance)
 *
 *   A Day is a canonical Listening item — one `listening_tests` row, its own `listening_questions`
 *   in their authored order, its own audio and its own revisions — exactly the shape a General
 *   section already has. Two facts were missing to express it: WHICH programme it belongs to, and
 *   WHICH day it is. Those are the two columns migration 0052 adds (`program_ref`,
 *   `program_ordinal`), with the database refusing a second item for the same day of the same
 *   programme.
 *
 *   Membership is therefore the item's OWN canonical questions, and their position is the existing
 *   `listening_questions.order` — the single ordering truth that attempts, review, practice and the
 *   MCQ drill all already read. Nothing is duplicated, no second order exists to drift, and no
 *   question content is copied: the day layer REFERENCES canonical questions, it does not restate
 *   them.
 *
 * THE LEARNER'S STATE IS NOT HERE. Staged progress lives in `listening_mcq_sessions`, keyed by
 * (user, question) — the existing table, unchanged. A day's status is DERIVED from those session
 * rows; there is no parallel per-day progress record and no second analytics system.
 *
 * PRACTICE, NEVER AN EXAM. Nothing in this module touches an attempt, a score or an IELTS band.
 * Completing Day 8 cannot change an Academic or General result, and no band is ever invented from
 * five practice questions.
 */

/** The stable identity of the programme. Never a display title, and never a number to parse. */
export const MCQ_PROGRAM_REF = "listening-mcq-program";

/**
 * The programme's authored shape: how many days it targets, and how many questions each day holds.
 *
 * The target is METADATA for staff (and for honest "12 / 30" arithmetic on published content). It is
 * never a licence to render a Day that does not exist: the learner catalogue lists published days
 * only, and a target of 30 with 8 published days shows exactly 8.
 */
export const MCQ_PROGRAM_DAY_TARGET = 30;
export const MCQ_DAY_QUESTION_COUNT = 5;

/**
 * THE FINAL STAGE of the drill. A day is complete when all five of its questions reach it, and NOT
 * when five sessions merely exist — a session is created the moment a learner looks at a question.
 *
 * Kept as a literal here rather than imported from the mastery service so this module can be read on
 * its own; `tests/listening-mcq-program.test.ts` asserts it equals the engine's own last stage, so
 * the two cannot drift.
 */
export const MCQ_FINAL_STAGE = "reasoned";

/** What a Day's own questions must satisfy to be publishable. */
export type McqDayQuestion = {
  number: number;
  /** The stored `type_code` — the canonical identity of the question. */
  typeCode?: string | null;
  /** The stored compatibility enum. */
  storageType?: string | null;
  options?: readonly string[] | null;
  correctAnswer?: string | null;
  /** The question's own prompt, when the caller has it, so a duplicated import is visible. */
  questionText?: string | null;
};

export type McqDayProblem = { question?: number; message: string };

/**
 * WHY A DAY MAY NOT BE PUBLISHED — as sentences, because the person fixing it is a human.
 *
 * The owner's rule: a learner-visible Day contains EXACTLY five valid multiple-choice questions.
 * A four-question day is refused (the missing one is not invented), a six-question day is refused
 * (the extra one is not silently dropped), a question that is not genuinely multiple choice is
 * refused (Matching and Map / Plan questions have option pools and letters for answers, and filing
 * either as MCQ is the mistake this product keeps having to guard against), and a question with no
 * key is refused (it could never be graded).
 *
 * A draft may hold 0–5 while staff are still authoring; this function is what PUBLICATION asks.
 */
export function mcqDayProblems(questions: readonly McqDayQuestion[]): McqDayProblem[] {
  const problems: McqDayProblem[] = [];
  if (questions.length !== MCQ_DAY_QUESTION_COUNT)
    problems.push({
      message: `A published day has exactly ${MCQ_DAY_QUESTION_COUNT} questions; this one has ${questions.length}.`,
    });

  const seen = new Set<number>();
  const seenContent = new Map<string, number>();
  for (const question of questions) {
    if (seen.has(question.number))
      problems.push({ question: question.number, message: `Question ${question.number} appears twice in this day.` });
    seen.add(question.number);

    /*
     * Genuine multiple choice ONLY, and proved by the question's own STATEMENT of its type.
     *
     * The tempting shortcut is the stored compatibility enum (`multiple_choice`), but that is exactly
     * how a legacy map/plan or matching row — both carry option pools, and older imports filed them
     * under that enum — would slip into a day. A day therefore requires a canonical MCQ id, which is
     * what authoring and the canonical import both write.
     */
    const identity = listeningQuestionIdentity({ typeCode: question.typeCode });
    const isMcq = identity.typeCode === "mcq_single" || identity.typeCode === "mcq_multi";
    if (!isMcq)
      problems.push({
        question: question.number,
        message: `Question ${question.number} is not a multiple-choice question (${identity.typeCode ?? question.typeCode ?? "no type stated"}); a day holds genuine MCQ only.`,
      });

    const options = (question.options ?? []).filter((option) => option.trim().length > 0);
    if (options.length < 2)
      problems.push({ question: question.number, message: `Question ${question.number} has ${options.length} usable option(s); multiple choice needs at least two.` });
    if (!(question.correctAnswer ?? "").trim())
      problems.push({ question: question.number, message: `Question ${question.number} has no correct answer, so it could never be graded.` });

    if (question.correctAnswer?.trim() && !mcqKeyOptions(question.correctAnswer, options, identity.typeCode === "mcq_multi"))
      problems.push({question: question.number, message: `Question ${question.number} has an answer key that does not identify valid options.`});
    if (new Set(options).size !== options.length)
      problems.push({question: question.number, message: `Question ${question.number} repeats an option.`});

    /*
     * The same question twice in one day — a duplicated import, most often. It is not "duplicate
     * membership" (a question row belongs to exactly one item, and positions are already checked);
     * it is the same CONTENT counted twice, which would give one learner two shots at one question
     * and call it five. Both the prompt and the option list must match, so two genuinely different
     * questions that happen to share a lead-in are never refused.
     */
    const prompt = (question.questionText ?? "").trim().toLowerCase();
    if (prompt) {
      const signature = `${prompt}\u0000${options.join("\u0001")}`;
      const already = seenContent.get(signature);
      if (already !== undefined)
        problems.push({ question: question.number, message: `Question ${question.number} repeats question ${already} in this day.` });
      else seenContent.set(signature, question.number);
    }
  }

  // The authored sequence: positions 1…5 with no gap and no re-use. A day the learner walks
  // through must not have two "question 3"s.
  const expected = Array.from({ length: MCQ_DAY_QUESTION_COUNT }, (_, index) => index + 1);
  const actual = [...seen].sort((a, b) => a - b);
  if (questions.length === MCQ_DAY_QUESTION_COUNT && actual.join(",") !== expected.join(","))
    problems.push({
      message: `A day is ordered 1…${MCQ_DAY_QUESTION_COUNT}; this one carries ${actual.join(", ")}.`,
    });

  return problems;
}

/** Is this item part of the dedicated programme at a specific day? */
export function isMcqDayRow(row: { programRef?: string | null; programOrdinal?: number | null }): boolean {
  return row.programRef === MCQ_PROGRAM_REF && typeof row.programOrdinal === "number" && row.programOrdinal >= 1;
}

/* -------------------------------------------------------------------------- */
/* The learner's day status — DERIVED, never stored                            */
/* -------------------------------------------------------------------------- */

export type McqDayQuestionState = {
  /** The learner's persisted stage for this question, or null when they never opened it. */
  stage: string | null;
  complete: boolean;
};

export type McqDayStatus = {
  /** Questions the learner finished (final stage reached). */
  completed: number;
  /** Questions they opened but have not finished. */
  inProgress: number;
  total: number;
  state: "not_started" | "in_progress" | "completed";
};

/**
 * A day's status, from its five questions' session stages and nothing else.
 *
 * The boundary the owner drew: a day is COMPLETED only when every question reached the final stage
 * — not when five sessions were created, and not when five option lists were revealed but never
 * answered. A day with no session at all is NOT STARTED; anything in between is IN PROGRESS.
 */
export function mcqDayStatus(states: readonly (McqDayQuestionState | null | undefined)[]): McqDayStatus {
  const total = states.length;
  let completed = 0;
  let inProgress = 0;
  for (const state of states) {
    if (!state?.stage) continue;
    if (state.complete) completed += 1;
    else inProgress += 1;
  }
  const state: McqDayStatus["state"] = total > 0 && completed === total ? "completed" : completed || inProgress ? "in_progress" : "not_started";
  return { completed, inProgress, total, state };
}

/** Map the learner's session rows onto a day's questions, by question id. */
export function mcqDayStates(
  questionIds: readonly string[],
  sessions: readonly { questionId: string; stage: string }[],
): McqDayQuestionState[] {
  const byQuestion = new Map(sessions.map((session) => [session.questionId, session.stage]));
  return questionIds.map((id) => {
    const stage = byQuestion.get(id) ?? null;
    return { stage, complete: stage === MCQ_FINAL_STAGE };
  });
}

/**
 * WHICH QUESTION OF THE DAY THE LEARNER IS ON — derived, never stored.
 *
 * The default is the first question they have not finished, so returning mid-day resumes at the
 * right question instead of restarting the day; once all five are finished the day opens at
 * question 1 for review. A requested position (the day's own 1…5 navigation) is honoured when it
 * points at a question that really is in this day, and otherwise the default stands — a URL never
 * invents a sixth question.
 */
export function mcqActivePosition(
  questions: readonly { stage: string | null }[],
  requested?: number | null,
): number {
  if (Number.isInteger(requested) && (requested as number) >= 1 && (requested as number) <= questions.length)
    return requested as number;
  const firstUnfinished = questions.findIndex((question) => question.stage !== MCQ_FINAL_STAGE);
  if (questions.length === 0) return 0;
  return firstUnfinished === -1 ? 1 : firstUnfinished + 1;
}

/**
 * The programme's headline numbers, from PUBLISHED content only.
 *
 * `days` is how many days exist (published and therefore learner-visible), not the target, so
 * "12 / 30" can never be claimed from an intention. When the corpus is partial the honest figure is
 * the partial one, and the target is reported separately for staff.
 */
export function mcqProgramProgress(input: { publishedDays: number; completedDays: number; completedQuestions: number }) {
  return {
    daysPublished: input.publishedDays,
    daysCompleted: input.completedDays,
    questionsPublished: input.publishedDays * MCQ_DAY_QUESTION_COUNT,
    questionsCompleted: input.completedQuestions,
    /** The authored target — for staff context, never presented as available content. */
    dayTarget: MCQ_PROGRAM_DAY_TARGET,
  };
}
