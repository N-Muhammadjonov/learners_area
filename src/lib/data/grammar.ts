import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarTopics, grammarExercises, grammarAttempts } from "@/db/schema";
import {
  summarizeTopicMastery,
  type AttemptRow,
  type GrammarActivity,
} from "@/lib/services/grammar/mastery";

export function listTopics() {
  return db.query.grammarTopics.findMany({ orderBy: asc(grammarTopics.order) });
}

export async function getTopicWithExercises(topicId: string) {
  const topic = await db.query.grammarTopics.findFirst({ where: eq(grammarTopics.id, topicId) });
  if (!topic) return null;
  const exercises = await db.query.grammarExercises.findMany({
    where: eq(grammarExercises.topicId, topicId),
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
  const topics = await listTopics();
  const exercises = await db.query.grammarExercises.findMany();
  const exerciseIds = exercises.map((e) => e.id);

  const attempts = exerciseIds.length
    ? await db.query.grammarAttempts.findMany({
        where: and(inArray(grammarAttempts.exerciseId, exerciseIds), eq(grammarAttempts.userId, userId)),
      })
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
    where: eq(grammarExercises.topicId, topicId),
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
