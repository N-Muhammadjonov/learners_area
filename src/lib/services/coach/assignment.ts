import "server-only";
import { evaluateAndPersist, type ServiceOutcome } from "./service";

/**
 * AssignmentEvaluationService — an orchestrator, not an evaluator.
 *
 * It decides *which* specialised service a piece of work belongs to, and does
 * not duplicate any of their logic:
 *
 *   objective multiple choice  -> deterministic grading (no AI involved)
 *   writing task               -> WritingEvaluationService
 *   speaking task              -> SpeakingEvaluationService
 *   grammar production         -> GrammarEvaluationService
 *   vocabulary activation      -> VocabularyFeedbackService
 *   anything else free-form    -> the resolver with an assignment request
 *
 * Only the last case reaches a provider generically, and RIWI refuses to invent
 * a band for it: it reports measured facts and a verdict.
 */

export type AssignmentTaskKind =
  | "objective_multiple_choice"
  | "writing_task"
  | "speaking_task"
  | "grammar_production"
  | "vocabulary_activation"
  | "free_form";

export type AssignmentDispatch =
  | { kind: "objective_multiple_choice"; reason: string }
  | { kind: "writing_task"; writingPromptId: string; reason: string }
  | { kind: "free_form"; reason: string };

/**
 * Classify an assignment from the data the platform actually has. An assignment
 * linked to a writing prompt is a writing task; without a linked task type there
 * is nothing to infer from, so it is treated as free-form rather than being
 * guessed into a band-scale evaluation.
 */
export function classifyAssignment(assignment: {
  relatedWritingPromptId: string | null;
  description: string | null;
}): AssignmentDispatch {
  if (assignment.relatedWritingPromptId) {
    return {
      kind: "writing_task",
      writingPromptId: assignment.relatedWritingPromptId,
      reason: "The assignment is linked to a writing prompt, so the writing rubric applies.",
    };
  }
  return {
    kind: "free_form",
    reason: "No task type is attached to this assignment, so it is evaluated as a free-form response.",
  };
}

export type AssignmentEvaluationRequest = {
  userId: string;
  assignmentId: string;
  title: string;
  description: string | null;
  studentResponse: string;
  language: "uz" | "en";
};

export async function evaluateAssignment(
  input: AssignmentEvaluationRequest
): Promise<ServiceOutcome> {
  return evaluateAndPersist({
    userId: input.userId,
    evaluationType: "assignment",
    sourceType: "assignment",
    sourceId: input.assignmentId,
    language: input.language,
    request: {
      evaluationType: "assignment",
      input: {
        title: input.title,
        description: input.description,
        studentResponse: input.studentResponse,
      },
    },
  });
}
