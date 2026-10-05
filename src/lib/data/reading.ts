import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
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
import { assessmentScope } from "@/lib/data/reading-assessments";
import { readingAttemptExpired } from "@/lib/reading/timer";
import { academicOnlyClause, generalMembership } from "@/lib/data/general-reading";

export async function listActivePassages() {
  // A draft, a not-yet-due schedule and an archive are all invisible here; the
  // one rule that decides that lives in the publication service. General Reading
  // (learning) passages are not Academic test passages.
  return db.query.readingPassages.findMany({
    where: and(liveWhere({
      publicationState: readingPassages.publicationState,
      publishAt: readingPassages.publishAt,
    }), await academicOnlyClause()),
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
  // A General Reading passage is learning material: it never becomes an Academic
  // exam attempt (and so can never be locked by, or unlock, exam state).
  if (await generalMembership(passage.id)) return null;
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

  const scope = await assessmentScope(attemptId, attempt.passageId);
  const [sections, answers] = await Promise.all([
    Promise.all(scope.passageIds.map(getPassageWithQuestions)),
    db.query.readingAnswers.findMany({ where: eq(readingAnswers.attemptId, attemptId) }),
  ]);
  if (sections.some((section) => !section)) return null;
  const data = sections.filter((section): section is NonNullable<typeof section> => Boolean(section));
  let offset = 0;
  const numbered = data.map((section) => {
    const numbers = new Map(section.questions.map((question, index) => [question.questionNo ?? question.order, offset + index + 1]));
    const questions = section.questions.map((question, index) => ({ ...question, order: offset + index + 1, questionNo: scope.title ? offset + index + 1 : question.questionNo }));
    const groups = section.groups.map((group) => ({ ...group,
      fromQuestionNo: scope.title ? numbers.get(group.fromQuestionNo ?? -1) ?? group.fromQuestionNo : group.fromQuestionNo,
      toQuestionNo: scope.title ? numbers.get(group.toQuestionNo ?? -1) ?? group.toQuestionNo : group.toQuestionNo,
    }));
    offset += questions.length;
    return { ...section, questions, groups };
  });
  const first = numbered[0]!;
  return {
    attempt, sections: numbered,
    passage: { ...first.passage,
      title: scope.title ?? first.passage.title,
      suggestedMinutes: scope.durationMinutes ?? first.passage.suggestedMinutes,
      bodyText: scope.title && attempt.status !== "in_progress" ? numbered.map(section => `${section.passage.title}\n\n${section.passage.bodyText}`).join("\n\n") : first.passage.bodyText,
    },
    questions: numbered.flatMap(section => section.questions),
    groups: numbered.flatMap(section => section.groups),
    paragraphs: first.paragraphs,
    occurrences: scope.title ? [] : first.occurrences,
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
  return db.transaction(async (tx) => {
    // Autosave and final submission serialize on the attempt row. Without the
    // lock, a last in-flight PATCH could replace the saved draft after submit.
    const [attempt] = await tx
      .select({
        id: readingAttempts.id,
        passageId: readingAttempts.passageId,
        startedAt: readingAttempts.startedAt,
        status: readingAttempts.status,
        suggestedMinutes: readingPassages.suggestedMinutes,
      })
      .from(readingAttempts)
      .innerJoin(readingPassages, eq(readingAttempts.passageId, readingPassages.id))
      .where(and(eq(readingAttempts.id, attemptId), eq(readingAttempts.userId, userId)))
      .limit(1)
      .for("update", { of: readingAttempts });
    if (!attempt) return { saved: 0, reason: "not_found" as const };
    if (attempt.status !== "in_progress") return { saved: 0, reason: "already_submitted" as const };
    const scope = await assessmentScope(attemptId, attempt.passageId, tx);
    const duration = scope.durationMinutes ?? attempt.suggestedMinutes;
    if (readingAttemptExpired(attempt.startedAt, duration)) return { saved: 0, reason: "expired" as const };

    // Only questions that really belong to this attempt's passage are accepted:
    // a client that sends somebody else's question id changes nothing. Collapse
    // forged duplicate ids too, since the table deliberately stores no score key.
    const questions = await tx.query.readingQuestions.findMany({
      where: inArray(readingQuestions.passageId, scope.passageIds),
    });
    const allowed = new Set(questions.map((question) => question.id));
    const rowsByQuestion = new Map<string, string>();
    for (const entry of entries) {
      if (allowed.has(entry.questionId)) rowsByQuestion.set(entry.questionId, entry.answer.slice(0, 4000));
    }

    // Recheck the deadline immediately before the write in case question lookup
    // itself crossed the attempt's deadline.
    if (readingAttemptExpired(attempt.startedAt, duration)) return { saved: 0, reason: "expired" as const };
    await tx.delete(readingAnswers).where(and(eq(readingAnswers.attemptId, attemptId), isNull(readingAnswers.isCorrect)));
    const rows = [...rowsByQuestion].map(([questionId, userAnswer]) => ({
      attemptId,
      questionId,
      userAnswer,
      isCorrect: null,
    }));
    if (rows.length > 0) await tx.insert(readingAnswers).values(rows);
    return { saved: rows.length, reason: "ok" as const };
  });
}
