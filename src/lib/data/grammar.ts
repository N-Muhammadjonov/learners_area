import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
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

export function listTopics() {
  return db.select({ id: grammarTopics.id, title: grammarTopics.title, skillArea: grammarTopics.skillArea, order: grammarTopics.order })
    .from(grammarTopics)
    .orderBy(asc(grammarTopics.order));
}

const GRAMMAR_QUERY_STOP_WORDS = new Set([
  "can", "could", "would", "please", "you", "me", "my", "the", "a", "an", "is", "are", "was", "were",
  "what", "how", "does", "do", "why", "about", "explain", "teach", "simply", "simple", "terms", "use",
  "grammar", "grammatical", "topic", "topics", "rule", "rules", "lesson", "lessons",
  "tushuntir", "tushuntiring", "izohla", "izohlang", "grammatika", "mavzu", "mavzusini", "qanday", "misol", "bilan",
  "объясни", "объясните", "почему", "как", "грамматика", "грамматику", "правило", "тема", "тему", "простыми", "словами",
]);

/** Find one unambiguous authored Grammar topic; never returns exercises or essay-derived text. */
export async function findGrammarTopic(query: string, database: typeof db = db) {
  const terms = [...new Set(query.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((term) => term.length >= 3 && term.length <= 40 && !GRAMMAR_QUERY_STOP_WORDS.has(term))
    .slice(0, 6);
  if (terms.length === 0) return null;
  const titleMatches = await database.select({
    id: grammarTopics.id, title: grammarTopics.title, explanation: grammarTopics.explanation,
    skillArea: grammarTopics.skillArea, order: grammarTopics.order,
  }).from(grammarTopics)
    .where(or(...terms.map((term) => ilike(grammarTopics.title, `%${term}%`))))
    .orderBy(asc(grammarTopics.order), asc(grammarTopics.id))
    .limit(20);
  const ranked = titleMatches.map((topic) => ({
    topic,
    score: terms.filter((term) => topic.title.normalize("NFKC").toLocaleLowerCase().includes(term)).length,
  })).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.topic.order - right.topic.order || left.topic.id.localeCompare(right.topic.id));
  if (!ranked[0] || ranked[1]?.score === ranked[0].score) return null;
  return ranked[0].topic;
}

/** A count, not a private exercise payload; uses the Grammar learner visibility predicate. */
export async function countVisibleGrammarExercises(topicId: string, userId: string, database: typeof db = db): Promise<number> {
  const [row] = await database.select({ count: sql<number>`count(*)::int` }).from(grammarExercises)
    .where(and(eq(grammarExercises.topicId, topicId), grammarVisibleTo(userId)));
  return row?.count ?? 0;
}

export async function getTopicWithExercises(topicId: string, userId: string, database: typeof db = db) {
  const [topic, exercises] = await Promise.all([
    database.query.grammarTopics.findFirst({ where: eq(grammarTopics.id, topicId) }),
    database.query.grammarExercises.findMany({
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
export async function getTopicMastery(userId: string) {
  const [topicsResult, exercisesResult, attemptsResult] = await Promise.allSettled([
    timed("grammar.topics", () => listTopics()),
    timed("grammar.exercises", () => db.select({ id: grammarExercises.id, topicId: grammarExercises.topicId })
      .from(grammarExercises)
      .where(grammarVisibleTo(userId))),
    timed("grammar.attempts", () => db
      .select({
        exerciseId: grammarAttempts.exerciseId,
        activity: grammarAttempts.activity,
        isCorrect: grammarAttempts.isCorrect,
        attemptedAt: grammarAttempts.attemptedAt,
      })
      .from(grammarAttempts)
      .innerJoin(grammarExercises, eq(grammarExercises.id, grammarAttempts.exerciseId))
      .where(and(eq(grammarAttempts.userId, userId), grammarVisibleTo(userId)))),
  ]);

  // Topic/exercise data defines the usable Grammar catalogue; preserve a local
  // section error for those failures while treating only mastery as optional.
  if (topicsResult.status === "rejected") throw topicsResult.reason;
  if (exercisesResult.status === "rejected") throw exercisesResult.reason;

  const topics = topicsResult.value;
  const exercises = exercisesResult.value;
  const attempts = attemptsResult.status === "fulfilled" ? attemptsResult.value : [];
  const exercisesByTopic = new Map<string, string[]>();
  for (const exercise of exercises) {
    const list = exercisesByTopic.get(exercise.topicId) ?? [];
    list.push(exercise.id);
    exercisesByTopic.set(exercise.topicId, list);
  }

  return topics.map((topic) => {
    const ids = new Set(exercisesByTopic.get(topic.id) ?? []);
    const rows: AttemptRow[] = attempts
      .filter((attempt) => ids.has(attempt.exerciseId))
      .map((attempt) => ({
        exerciseId: attempt.exerciseId,
        activity: attempt.activity as GrammarActivity,
        isCorrect: attempt.isCorrect,
        attemptedAt: attempt.attemptedAt,
      }));

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
