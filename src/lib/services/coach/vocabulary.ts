import "server-only";
import { evaluateAndPersist, type ServiceOutcome } from "./service";

export type VocabularyEvaluationRequest = {
  userId: string;
  /** The vocabulary_usages row that stores this sentence. */
  usageId: string;
  targetWord: string;
  definition: string;
  studentSentence: string;
  language: "uz" | "en";
};

/**
 * VocabularyFeedbackService — active use, not recognition.
 *
 * The spaced-repetition queue measures recognition (did you remember the word
 * when you saw it). This service measures something else: can you *produce* the
 * word in your own sentence. The two are stored and reported separately, and a
 * sentence is never credited just because it contains the target string.
 */
export async function evaluateVocabularyUsage(
  input: VocabularyEvaluationRequest
): Promise<ServiceOutcome> {
  return evaluateAndPersist({
    userId: input.userId,
    evaluationType: "vocabulary",
    sourceType: "vocabulary_usage",
    sourceId: input.usageId,
    language: input.language,
    request: {
      evaluationType: "vocabulary",
      assessmentContractKey: "vocabulary.use-in-sentence",
      input: {
        targetWord: input.targetWord,
        definition: input.definition,
        studentSentence: input.studentSentence,
      },
    },
  });
}
