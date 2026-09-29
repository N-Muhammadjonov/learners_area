import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { timed } from "@/lib/observability/timing";
import { grammarTopics, grammarExercises, grammarAttempts } from "@/db/schema";
import {
  summarizeTopicMastery,
  type AttemptRow,
  type GrammarActivity,
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

export function listTopics() {
  return db.query.grammarTopics.findMany({ orderBy: asc(grammarTopics.order) });
}

export async function getTopicWithExercises(topicId: string, userId: string) {
  const topic = await db.query.grammarTopics.findFirst({ where: eq(grammarTopics.id, topicId) });
  if (!topic) return null;
  const exercises = await db.query.grammarExercises.findMany({
    where: and(eq(grammarExercises.topicId, topicId), grammarVisibleTo(userId)),
    orderBy: asc(grammarExercises.order),
  });
  return { topic, exercises };
}

/**
 * Mastery per topic, computed from the attempt rows themselves.
 *
 * "Mastery" is not a stored flag: it is re-derived every time from the attempts
 * (latest per exercise and activity, three separate Asia/Tashkent days, ~80%
 * accuracy across all three activities). A stored counter would eventually
 * disagree with the history that produced it.
 */
export async function getTopicMastery(userId: string) {
  // Independent catalogue reads run in parallel; the history query still follows
  // them because its authorised exercise-id set is needed for the predicate.
  const [topics, exercises] = await Promise.all([
    timed("grammar.topics", () => listTopics()),
    timed("grammar.exercises", () => db.query.grammarExercises.findMany({ where: grammarVisibleTo(userId) })),
  ]);
  const exerciseIds = exercises.map((e) => e.id);

  const attempts = exerciseIds.length
    ? await timed("grammar.attempts", () => db.query.grammarAttempts.findMany({
        where: and(inArray(grammarAttempts.exerciseId, exerciseIds), eq(grammarAttempts.userId, userId)),
      }))
    : [];

  const exercisesByTopic = new Map<string, string[]>();
  for (const e of exercises) {
    const list = exercisesByTopic.get(e.topicId) ?? [];
    list.push(e.id);
    exercisesByTopic.set(e.topicId, list);
  }

  return topics.map((topic) => {
    const ids = new Set(exercisesByTopic.get(topic.id) ?? []);
    const rows: AttemptRow[] = attempts
      .filter((a) => ids.has(a.exerciseId))
      .map((a) => ({
        exerciseId: a.exerciseId,
        activity: a.activity as GrammarActivity,
        isCorrect: a.isCorrect,
        attemptedAt: a.attemptedAt,
      }));

    return {
      topic,
      totalExercises: ids.size,
      mastery: summarizeTopicMastery(rows),
    };
  });
}

/** The same summary for one topic, for the topic page's mastery card. */
export async function getTopicMasteryFor(userId: string, topicId: string) {
  const exercises = await db.query.grammarExercises.findMany({
    where: and(eq(grammarExercises.topicId, topicId), grammarVisibleTo(userId)),
  });
  if (exercises.length === 0) {
    return {
      topicId,
      totalExercises: 0,
      mastery: summarizeTopicMastery([]),
    };
  }

  const attempts = await db.query.grammarAttempts.findMany({
    where: and(
      inArray(
        grammarAttempts.exerciseId,
        exercises.map((e) => e.id)
      ),
      eq(grammarAttempts.userId, userId)
    ),
  });

  const rows: AttemptRow[] = attempts.map((a) => ({
    exerciseId: a.exerciseId,
    activity: a.activity as GrammarActivity,
    isCorrect: a.isCorrect,
    attemptedAt: a.attemptedAt,
  }));

  return { topicId, totalExercises: exercises.length, mastery: summarizeTopicMastery(rows) };
}
