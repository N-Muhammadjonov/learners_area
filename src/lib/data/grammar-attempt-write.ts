import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, grammarAttempts, grammarExercises, users } from "@/db/schema";
import { grammarVisibleTo } from "./grammar";

export const grammarObjectiveSubmissionSchema = z.object({
  answers: z.array(z.object({
    exerciseId: z.string().uuid(),
    selectedOption: z.string().min(1).max(2000),
  }).strict()).min(1).max(100),
}).strict().refine(value => new Set(value.answers.map(answer => answer.exerciseId)).size === value.answers.length);

/** Canonical choice grading and its activity event commit together. Validate
 * the complete batch before writing anything or releasing an answer key. */
export async function submitGrammarObjective(userId: string, topicId: string, input: unknown, database = db) {
  const parsed = grammarObjectiveSubmissionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, status: 400 as const, error: "invalid_input" as const };
  return database.transaction(async tx => {
    const [user] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, userId), eq(users.accountStatus, "active"))).for("share");
    if (!user) return { ok: false as const, status: 401 as const, error: "unauthenticated" as const };
    const exercises = await tx.select().from(grammarExercises)
      .where(and(eq(grammarExercises.topicId, topicId), grammarVisibleTo(userId))).for("share");
    const byId = new Map(exercises.map(exercise => [exercise.id, exercise]));
    if (parsed.data.answers.some(answer => !byId.has(answer.exerciseId))) {
      return { ok: false as const, status: 404 as const, error: "not_found" as const };
    }
    const selected = parsed.data.answers.map(answer => ({ answer, exercise: byId.get(answer.exerciseId)! }));
    if (selected.some(({ exercise }) => !Array.isArray(exercise.options) || exercise.options.length < 2
      || exercise.options.some(option => typeof option !== "string" || !option.trim())
      || new Set(exercise.options).size !== exercise.options.length
      || !exercise.options.includes(exercise.correctOption))) {
      return { ok: false as const, status: 409 as const, error: "assessment_metadata_unsupported" as const };
    }
    if (selected.some(({ answer, exercise }) => !exercise.options.includes(answer.selectedOption))) {
      return { ok: false as const, status: 400 as const, error: "invalid_input" as const };
    }
    const results = selected.map(({ answer, exercise }) => ({
      exerciseId: exercise.id,
      isCorrect: answer.selectedOption === exercise.correctOption,
      correctOption: exercise.correctOption,
      explanation: exercise.explanation,
    }));
    await tx.insert(grammarAttempts).values(selected.map(({ answer, exercise }, index) => ({
      userId, exerciseId: exercise.id, activity: "correct_it" as const,
      selectedOption: answer.selectedOption, isCorrect: results[index]!.isCorrect,
    })));
    await tx.insert(activityEvents).values({
      userId, type: "GRAMMAR_TOPIC_ATTEMPTED",
      payload: { topicId, correct: results.filter(result => result.isCorrect).length, total: results.length },
    });
    return { ok: true as const, results };
  });
}
