import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  lexicalOccurrences,
  readingAnswers,
  readingAttempts,
  readingPassageParagraphs,
  readingPassages,
  readingQuestionGroups,
  readingQuestions,
} from "@/db/schema";
import { isLive, liveWhere } from "@/lib/services/cms/publication";

export function listActivePassages() {
  // A draft, a not-yet-due schedule and an archive are all invisible here; the
  // one rule that decides that lives in the publication service.
  return db.query.readingPassages.findMany({
    where: liveWhere({
      publicationState: readingPassages.publicationState,
      publishAt: readingPassages.publishAt,
    }),
    orderBy: asc(readingPassages.createdAt),
  });
}

/**
 * Load a passage only if a student may start work on it.
 *
 * The list filter alone is not enough: a passage that was withdrawn would still
 * be open to anyone who kept its id or bookmarked the URL. `isLive` is applied
 * here, at the moment of starting, and deliberately NOT when a past attempt is
 * read back — an archived passage must stay readable to the student who already
 * worked on it.
 */
export async function getStartablePassage(passageId: string) {
  const passage = await db.query.readingPassages.findFirst({ where: eq(readingPassages.id, passageId) });
  if (!passage || !isLive(passage)) return null;
  return passage;
}

export async function getPassageWithQuestions(passageId: string) {
  const passage = await db.query.readingPassages.findFirst({ where: eq(readingPassages.id, passageId) });
  if (!passage) return null;

  /*
   * A passage is read with three things attached, and all three are needed to
   * answer the questions honestly:
   *
   *   questions  the rows themselves;
   *   groups     the instruction block each question belongs to — "Choose TWO
   *              letters, A–E" is the question, and without it some questions are
   *              literally a blank line;
   *   paragraphs the paragraph letters the matching questions refer to.
   */
  const [questions, groups, paragraphs, occurrences] = await Promise.all([
    db.query.readingQuestions.findMany({
      where: eq(readingQuestions.passageId, passageId),
      orderBy: asc(readingQuestions.order),
    }),
    db.query.readingQuestionGroups.findMany({
      where: eq(readingQuestionGroups.passageId, passageId),
      orderBy: asc(readingQuestionGroups.position),
    }),
    db.query.readingPassageParagraphs.findMany({
      where: eq(readingPassageParagraphs.passageId, passageId),
      orderBy: asc(readingPassageParagraphs.position),
    }),
    db.select({ id: lexicalOccurrences.id, startChar: lexicalOccurrences.startChar, endChar: lexicalOccurrences.endChar, surfaceForm: lexicalOccurrences.surfaceForm }).from(lexicalOccurrences).where(eq(lexicalOccurrences.passageId, passageId)),
  ]);

  return { passage, questions, groups, paragraphs, occurrences };
}

export async function getAttemptDetail(attemptId: string, userId: string) {
  const attempt = await db.query.readingAttempts.findFirst({
    where: and(eq(readingAttempts.id, attemptId), eq(readingAttempts.userId, userId)),
  });
  if (!attempt) return null;

  const [passageData, answers] = await Promise.all([
    getPassageWithQuestions(attempt.passageId),
    db.query.readingAnswers.findMany({ where: eq(readingAnswers.attemptId, attemptId) }),
  ]);
  if (!passageData) return null;

  return {
    attempt,
    passage: passageData.passage,
    questions: passageData.questions,
    groups: passageData.groups,
    paragraphs: passageData.paragraphs,
    occurrences: passageData.occurrences,
    answers,
  };
}

export function listUserAttempts(userId: string) {
  return db
    .select({ attempt: readingAttempts, passage: readingPassages })
    .from(readingAttempts)
    .innerJoin(readingPassages, eq(readingAttempts.passageId, readingPassages.id))
    .where(eq(readingAttempts.userId, userId))
    .orderBy(desc(readingAttempts.startedAt));
}

/**
 * Save the answers a student has entered so far.
 *
 * Without this, a 20-minute reading task lives only in a browser tab: close it,
 * lose the laptop, or simply reload and every answer is gone — which is what
 * "Davom etish" on the library card used to mean in practice: resume an attempt
 * that had nothing in it.
 *
 * Only an attempt that belongs to the student and is still open can be written
 * to, and the write replaces that attempt's own draft rows — no other attempt,
 * and no completed score, is ever touched.
 */
export async function saveDraftAnswers(
  attemptId: string,
  userId: string,
  entries: { questionId: string; answer: string }[]
) {
  const attempt = await db.query.readingAttempts.findFirst({
    where: and(eq(readingAttempts.id, attemptId), eq(readingAttempts.userId, userId)),
  });
  if (!attempt) return { saved: 0, reason: "not_found" as const };
  if (attempt.status !== "in_progress") return { saved: 0, reason: "already_submitted" as const };

  // Only questions that really belong to this attempt's passage are accepted:
  // a client that sends somebody else's question id changes nothing.
  const questions = await db.query.readingQuestions.findMany({
    where: eq(readingQuestions.passageId, attempt.passageId),
  });
  const allowed = new Set(questions.map((question) => question.id));

  await db.transaction(async (tx) => {
    await tx.delete(readingAnswers).where(eq(readingAnswers.attemptId, attemptId));
    const rows = entries.filter((entry) => allowed.has(entry.questionId));
    if (rows.length > 0) {
      await tx.insert(readingAnswers).values(
        rows.map((entry) => ({
          attemptId,
          questionId: entry.questionId,
          userAnswer: entry.answer.slice(0, 4000),
          isCorrect: null,
        }))
      );
    }
  });

  return { saved: entries.filter((entry) => allowed.has(entry.questionId)).length, reason: "ok" as const };
}
