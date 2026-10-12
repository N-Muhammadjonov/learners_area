import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningAnswers, listeningAttempts, listeningDrafts, listeningQuestions } from "@/db/schema";
import { lexicalAssistanceAllowed } from "@/lib/listening/lexical-policy";
import { listeningExamState } from "@/lib/data/full-listening";
import { listeningQuestionsForAttempt } from "@/lib/listening/question-set";
import { authoredSectionNumber, getOpenableSection } from "@/lib/data/listening-general";
import { startListeningAttempt } from "@/lib/data/listening-attempt-write";
import type { ListeningExamQuestion } from "@/components/listening/NativeListeningExam";
import type { MapDiagram } from "@/lib/listening/map-diagram";
import { listeningInputModeFor } from "@/lib/listening/question-control";
import type { Dictionary } from "@/lib/i18n/en";
import type { Role } from "@/lib/auth/roles";

/**
 * ONE standalone General Listening section, resolved for a learner.
 *
 * This is the single server-side loader behind BOTH URLs that can show a section: the section's
 * own stable address (`/app/listening/general/<sectionId>`) and the internal attempt address
 * (`/app/listening/attempts/<attemptId>`, which the learner reaches from their history and is
 * never linked from the catalogue). Two renderers reading one loader is what keeps the promise
 * that a section is ONE exercise in ONE place — the presentation cannot drift, because the
 * decision of what a learner sees is made here and nowhere else.
 *
 * What it does, in the owner's order:
 *   1. the SAME gate the catalogue uses (`getOpenableSection`) — a URL can never open something
 *      the catalogue does not list, and vice versa;
 *   2. a NEW attempt for a section with no open one — `startListeningAttempt` is idempotent and
 *      row-locked, so this is a resume-or-create and never a second parallel attempt;
 *   3. the learner's newest attempt decides the view: an unfinished one is the EXERCISE, a
 *      finished one is the RESULT (never a hidden activity, never an Academic exam framing).
 *
 * The attempt is created on a GET because the section URL IS the exercise: reload, back, forward
 * and a bookmark must all land on the same thing (owner: "opening a section = one activity,
 * immediately"). The create is a resume-or-insert under a row lock, so repeated loads are safe.
 */
export type SectionExerciseView =
  | {
      kind: "exercise";
      attemptId: string;
      testId: string;
      title: string;
      audioUrl: string;
      imageUrl: string | null;
      mapDiagram: MapDiagram | undefined;
      duration: number | undefined;
      questions: ListeningExamQuestion[];
      initial: Record<string, string>;
      audioPosition: number;
      audioStartedAt: string | null;
      /** May this learner look a word up / highlight, from the SHARED lexical policy? */
      lexicalAssistance: boolean;
    }
  | {
      kind: "result";
      attemptId: string;
      testId: string;
      title: string;
      score: number | null;
      total: number | null;
      questions: (typeof listeningQuestions.$inferSelect)[];
      answers: (typeof listeningAnswers.$inferSelect)[];
    }
  | null;

export async function loadSectionExercise(
  sectionId: string,
  user: { id: string; role: Role },
  dict: Dictionary,
  database: typeof db = db,
): Promise<SectionExerciseView> {
  const section = await getOpenableSection(sectionId, user.id, database);
  if (!section) return null;

  /*
   * What does this learner already have here? The order matters, and it is the owner's:
   *
   *   • an OPEN attempt  -> the exercise, resumed. Nothing is created: the learner continues the
   *     attempt they already started.
   *   • a FINISHED attempt (and no open one) -> the RESULT. Opening a finished section shows what
   *     happened; it must not silently begin a new attempt behind the learner's back. Taking the
   *     section again is an explicit action (the retake control), which creates the new attempt.
   *   • nothing at all -> create the attempt now, so the address opens on the exercise itself.
   */
  const [newest] = await database
    .select()
    .from(listeningAttempts)
    .where(and(eq(listeningAttempts.userId, user.id), eq(listeningAttempts.testId, sectionId)))
    .orderBy(desc(listeningAttempts.startedAt))
    .limit(1);

  const open = newest?.status === "in_progress" ? newest : null;
  const attemptId = open ? open.id : newest ? null : await startListeningAttempt(user.id, sectionId, database);
  if (!attemptId && !newest) return null;

  const sectionNo = section.package
    ? (section.package.sections[0]?.number ?? 1)
    : await authoredSectionNumber(sectionId, database);

  const attempt: typeof listeningAttempts.$inferSelect | undefined =
    attemptId && attemptId !== newest?.id
      ? (
          await database
            .select()
            .from(listeningAttempts)
            .where(and(eq(listeningAttempts.id, attemptId), eq(listeningAttempts.userId, user.id)))
            .limit(1)
        )[0]
      : newest;
  if (!attempt) return null;

  if (attempt.status !== "in_progress") {
    /*
     * The review reads THIS attempt's own set and its authored evidence — the questions the
     * learner actually answered, with the explanations the centre wrote for them. A later
     * revision's questions and evidence are not this learner's result.
     */
    const [answers, reviewQuestions] = await Promise.all([
      database.query.listeningAnswers.findMany({ where: eq(listeningAnswers.attemptId, attempt.id) }),
      listeningQuestionsForAttempt(attempt, database),
    ]);
    return {
      kind: "result",
      attemptId: attempt.id,
      testId: sectionId,
      title: section.test.title,
      score: attempt.score,
      total: attempt.totalQuestions,
      questions: reviewQuestions.length ? reviewQuestions : section.questions,
      answers,
    };
  }

  /*
   * THE ATTEMPT'S OWN SET, never the live one.
   *
   * `getOpenableSection` answers "is this section open, and would a learner starting now get
   * questions?" — but the questions a learner RENDERS must be the ones their attempt was bound to
   * when it started. Reading the live set here would swap a v1 attempt onto v2's questions the
   * moment a revision is published: the learner's saved answers would point at rows they can no
   * longer see, and their score would be computed against a set they never answered. The attempt's
   * bound set is therefore resolved separately, with the live set only as the fallback for an
   * attempt that has no questions of its own (an unbound, legacy item).
   */
  const attemptQuestions = await listeningQuestionsForAttempt(attempt, database);
  const questions = attemptQuestions.length ? attemptQuestions : section.questions;

  const draft = await database.query.listeningDrafts.findFirst({ where: eq(listeningDrafts.attemptId, attempt.id) });
  /*
   * May this learner look a word up? The SAME policy the lexical API routes ask, with the mode
   * the source's own product implies — the surface and the server can never disagree, and a
   * section (a learning activity) is not locked out of its own vocabulary the way a running
   * graded full exam is.
   */
  const lexicalAssistance = lexicalAssistanceAllowed("SECTION_PRACTICE", await listeningExamState(user, sectionId, database));

  return {
    kind: "exercise",
    attemptId: attempt.id,
    testId: sectionId,
    title: section.test.title,
    audioUrl: section.test.audioUrl ?? "",
    imageUrl: section.imageObjectKey ? `/api/resources/${section.imageObjectKey}` : null,
    mapDiagram: section.package?.mapDiagram,
    duration: section.package?.audio.durationSec,
    questions: questions.map((row) => ({
      id: row.id,
      number: row.order,
      section: sectionNo ?? 1,
      text: row.questionText,
      instruction: dict.listening.general.questionInstruction,
      options: row.options ?? [],
      // The control is the CANONICAL model's decision (§14/§15): the row states a type code, the
      // registry states its answer model, and this is the only place the two are put together.
      input: listeningInputModeFor({ typeCode: row.typeCode, options: row.options }),
    })),
    initial: draft?.answers ?? {},
    audioPosition: draft?.audioPosition ?? 0,
    audioStartedAt: draft?.audioStartedAt?.toISOString() ?? null,
    lexicalAssistance,
  };
}
