import "server-only";
import { evaluateAndPersist, type ServiceOutcome } from "./service";

export type GrammarEvaluationRequest = {
  userId: string;
  /** The grammar_attempts row that stores this produced answer. */
  attemptId: string;
  promptText: string;
  studentAnswer: string;
  targetStructure: string | null;
  sampleAnswer: string | null;
  language: "uz" | "en";
};

/**
 * GrammarEvaluationService — for *produced* answers.
 *
 * Multiple-choice items stay on deterministic objective grading (the submit
 * route compares the option directly, which is correct and cheap). This service
 * exists for the case where the student writes their own sentence, because that
 * cannot be graded by string equality: a correct answer may use completely
 * different words from the sample answer.
 *
 * Result: a verdict (correct / mostly correct / needs correction) with the
 * measured facts behind it — never a fabricated band score.
 */
export async function evaluateGrammarProduction(
  input: GrammarEvaluationRequest
): Promise<ServiceOutcome> {
  return evaluateAndPersist({
    userId: input.userId,
    evaluationType: "grammar",
    sourceType: "grammar_attempt",
    sourceId: input.attemptId,
    language: input.language,
    request: {
      evaluationType: "grammar",
      input: {
        promptText: input.promptText,
        studentAnswer: input.studentAnswer,
        targetStructure: input.targetStructure,
        sampleAnswer: input.sampleAnswer,
      },
    },
  });
}
