import type { EvaluationRecord } from "@/lib/data/evaluations";

/** An evaluation of another user, domain or answer cannot confirm this usage. */
export function vocabularyEvaluationMatchesUsage(
  evaluation: EvaluationRecord,
  userId: string,
  usageId: string,
): boolean {
  return evaluation.userId === userId
    && evaluation.evaluationType === "vocabulary"
    && evaluation.sourceType === "vocabulary_usage"
    && evaluation.sourceId === usageId
    && evaluation.overallEstimate === null
    && evaluation.verdict !== null;
}
