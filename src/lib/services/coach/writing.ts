import "server-only";
import { evaluateAndPersist, type ServiceOutcome } from "./service";
import type { WritingTaskType } from "./types";

export type WritingEvaluationRequest = {
  userId: string;
  submissionId: string;
  taskType: WritingTaskType;
  prompt: string;
  content: string;
  targetWordCount: number;
  language: "uz" | "en";
};

/**
 * WritingEvaluationService.
 *
 * Provider-independent: it builds the evaluation request, hands it to the
 * resolver and persists the normalized result. Which evaluator answers — RIWI
 * today, a configured external model later — is decided by configuration, not
 * by this file. Callers (the submit route) see the same shape either way.
 */
export async function evaluateWritingSubmission(
  input: WritingEvaluationRequest
): Promise<ServiceOutcome> {
  return evaluateAndPersist({
    userId: input.userId,
    evaluationType: "writing",
    sourceType: "writing_submission",
    sourceId: input.submissionId,
    language: input.language,
    request: {
      evaluationType: "writing",
      input: {
        taskType: input.taskType,
        prompt: input.prompt,
        content: input.content,
        targetWordCount: input.targetWordCount,
      },
    },
  });
}
