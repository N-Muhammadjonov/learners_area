import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarTopics, grammarExercises, grammarAttempts } from "@/db/schema";

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

/** Mastery per topic = correct / attempted, using each exercise's most recent attempt only. */
export async function getTopicMastery(userId: string) {
  const topics = await listTopics();
  const exercises = await db.query.grammarExercises.findMany();
  const exerciseIds = exercises.map((e) => e.id);

  const attempts = exerciseIds.length
    ? await db
        .select()
        .from(grammarAttempts)
        .where(inArray(grammarAttempts.exerciseId, exerciseIds))
        .orderBy(desc(grammarAttempts.attemptedAt))
    : [];

  const latestByExercise = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) {
    if (a.userId !== userId) continue;
    if (!latestByExercise.has(a.exerciseId)) latestByExercise.set(a.exerciseId, a);
  }

  const exercisesByTopic = new Map<string, string[]>();
  for (const e of exercises) {
    const list = exercisesByTopic.get(e.topicId) ?? [];
    list.push(e.id);
    exercisesByTopic.set(e.topicId, list);
  }

  return topics.map((topic) => {
    const ids = exercisesByTopic.get(topic.id) ?? [];
    const attempted = ids.filter((id) => latestByExercise.has(id));
    const correct = attempted.filter((id) => latestByExercise.get(id)!.isCorrect);
    return {
      topic,
      totalExercises: ids.length,
      attempted: attempted.length,
      correct: correct.length,
    };
  });
}
