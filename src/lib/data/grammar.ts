import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { timed } from "@/lib/observability/timing";
import { grammarTopics, grammarExercises, grammarAttempts } from "@/db/schema";
import {
  summarizeTopicMastery,
  type AttemptRow,
  type GrammarActivity,
  type TopicMastery,
} from "@/lib/services/grammar/mastery";

/** Learner surfaces expose shared content and only the caller's essay-derived work.
 * Requiring both nulls for shared rows fails closed for an incomplete backfill.
 * Staff authoring has its own administrator-guarded paths.
 */
export function grammarVisibleTo(userId: string) {
  return or(eq(grammarExercises.sourceOwnerUserId, userId),
    and(isNull(grammarExercises.sourceOwnerUserId), isNull(grammarExercises.sourceSubmissionId)))!;
}

export function getGrammarExerciseForUser(id: string, userId: string) {
  return db.query.grammarExercises.findFirst({ where: and(eq(grammarExercises.id, id), grammarVisibleTo(userId)) });
}

/**
 * Topics a learner may see. Grammar topics carry no publish moment (a schedule
 * would need a column they do not have), so "published" is the whole rule — an
 * authored draft topic stays out of the learner's list (§41).
 */
export function listTopics(area?: "writing" | "speaking") {
  return db.select({ id: grammarTopics.id, title: grammarTopics.title, skillArea: grammarTopics.skillArea, order: grammarTopics.order })
    .from(grammarTopics)
    .where(and(eq(grammarTopics.publicationState, "published"), area ? eq(grammarTopics.skillArea, area) : undefined))
    .orderBy(asc(grammarTopics.order));
}

export async function getTopicWithExercises(topicId: string, userId: string) {
  const [topic, exercises] = await Promise.all([
    db.query.grammarTopics.findFirst({
      where: and(eq(grammarTopics.id, topicId), eq(grammarTopics.publicationState, "published")),
    }),
    db.query.grammarExercises.findMany({
      where: and(eq(grammarExercises.topicId, topicId), grammarVisibleTo(userId)),
      orderBy: asc(grammarExercises.order),
    }),
  ]);
  if (!topic) return null;
  return { topic, exercises };
}

/**
 * Mastery per topic, computed from the attempt rows themselves.
 *
 * Topics and visible exercises are the section core. Learner attempts are a
 * secondary mastery panel: an unavailable history must not hide the topics or
 * practice links, and is represented as unavailable rather than a false zero.
 */
export async function getTopicMastery(userId: string, area?: "writing" | "speaking") {
  const selectedTopics = db.select({ id: grammarTopics.id }).from(grammarTopics)
    .where(and(eq(grammarTopics.publicationState, "published"), area ? eq(grammarTopics.skillArea, area) : undefined));
  const [topicsResult, exercisesResult, attemptsResult] = await Promise.allSettled([
    timed("grammar.topics", () => listTopics(area)),
    timed("grammar.exercises", () => db.select({ id: grammarExercises.id, topicId: grammarExercises.topicId })
      .from(grammarExercises)
      .where(and(grammarVisibleTo(userId), inArray(grammarExercises.topicId, selectedTopics)))),
    timed("grammar.attempts", () => db
      .select({
        exerciseId: grammarAttempts.exerciseId,
        activity: grammarAttempts.activity,
        isCorrect: grammarAttempts.isCorrect,
        attemptedAt: grammarAttempts.attemptedAt,
      })
      .from(grammarAttempts)
      .innerJoin(grammarExercises, eq(grammarExercises.id, grammarAttempts.exerciseId))
      .where(and(eq(grammarAttempts.userId, userId), grammarVisibleTo(userId), inArray(grammarExercises.topicId, selectedTopics)))),
  ]);

  // Topic/exercise data defines the usable Grammar catalogue; preserve a local
  // section error for those failures while treating only mastery as optional.
  if (topicsResult.status === "rejected") throw topicsResult.reason;
  if (exercisesResult.status === "rejected") throw exercisesResult.reason;

  const topics = topicsResult.value;
  const exercises = exercisesResult.value;
  const attempts = attemptsResult.status === "fulfilled" ? attemptsResult.value : [];
  const exercisesByTopic = new Map<string, string[]>();
  const topicByExercise = new Map<string, string>();
  for (const exercise of exercises) {
    topicByExercise.set(exercise.id, exercise.topicId);
    const list = exercisesByTopic.get(exercise.topicId) ?? [];
    list.push(exercise.id);
    exercisesByTopic.set(exercise.topicId, list);
  }
  const attemptsByTopic = new Map<string, AttemptRow[]>();
  for (const attempt of attempts) {
    const topicId = topicByExercise.get(attempt.exerciseId);
    if (!topicId) continue;
    const rows = attemptsByTopic.get(topicId) ?? [];
    rows.push({ ...attempt, activity: attempt.activity as GrammarActivity });
    attemptsByTopic.set(topicId, rows);
  }

  return topics.map((topic) => {
    const ids = new Set(exercisesByTopic.get(topic.id) ?? []);
    const rows = attemptsByTopic.get(topic.id) ?? [];

    return {
      topic,
      totalExercises: ids.size,
      mastery: attemptsResult.status === "fulfilled" ? summarizeTopicMastery(rows) : null as TopicMastery | null,
      masteryUnavailable: attemptsResult.status === "rejected",
    };
  });
}

/** The same summary for one topic, for the topic page's mastery card. */
export async function getTopicMasteryFor(userId: string, topicId: string) {
  try {
    // Topic detail already loads its visible exercise rows. The joined predicate
    // keeps the attempt read within the same ownership boundary without reading
    // that exercise catalogue a second time.
    const attempts = await db.select({
      exerciseId: grammarAttempts.exerciseId,
      activity: grammarAttempts.activity,
      isCorrect: grammarAttempts.isCorrect,
      attemptedAt: grammarAttempts.attemptedAt,
    })
      .from(grammarAttempts)
      .innerJoin(grammarExercises, eq(grammarExercises.id, grammarAttempts.exerciseId))
      .where(and(
        eq(grammarAttempts.userId, userId),
        eq(grammarExercises.topicId, topicId),
        grammarVisibleTo(userId),
      ));

    const rows: AttemptRow[] = attempts.map((attempt) => ({
      exerciseId: attempt.exerciseId,
      activity: attempt.activity as GrammarActivity,
      isCorrect: attempt.isCorrect,
      attemptedAt: attempt.attemptedAt,
    }));

    return { topicId, mastery: summarizeTopicMastery(rows), unavailable: false as const };
  } catch {
    return { topicId, mastery: null, unavailable: true as const };
  }
}
