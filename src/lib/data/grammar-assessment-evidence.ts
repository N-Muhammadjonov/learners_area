import { and, eq, sql } from "drizzle-orm";
import { evaluations, grammarAttempts, grammarExercises } from "@/db/schema";

/** Exact domain/owner/source/activity binding for the joined evaluation. */
export function grammarEvaluationMatch(userId: string) {
  return and(eq(evaluations.userId, userId), eq(evaluations.evaluationType, "grammar"),
    eq(evaluations.sourceType, "grammar_attempt"), eq(evaluations.sourceId, grammarAttempts.id),
    sql`${evaluations.overallEstimate} is null`, sql`${evaluations.assessmentContractKey} = case ${grammarAttempts.activity}
      when 'correct_it' then 'grammar.correct-it' when 'translate_it' then 'grammar.translate-assessed'
      when 'activate_it' then 'grammar.activate-it' end`);
}

/** Pending written production is not an objective wrong answer. Older written
 * correction rows stored in selectedOption count as objective only if they
 * actually name an authored option. No score or verdict is invented here. */
export function grammarAssessedVerdict() {
  return sql<"correct" | "mostly_correct" | "needs_correction" | null>`case
    when ${grammarAttempts.activity} = 'correct_it' and ${grammarAttempts.responseText} is null
      and jsonb_typeof(${grammarExercises.options}) = 'array'
      and ${grammarExercises.options} ? ${grammarAttempts.selectedOption}
    then case when ${grammarAttempts.isCorrect} then 'correct' else 'needs_correction' end
    else ${evaluations.verdict}::text end`;
}
