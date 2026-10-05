import { composeAssessmentPrompt } from "@/lib/services/coach/contracts/compose";
import { getAssessmentContract } from "@/lib/services/coach/contracts/registry";
import type { AssessmentContractKey } from "@/lib/services/coach/contracts/types";

/**
 * Compatibility facade for all transport adapters. The canonical content lives
 * in coach/contracts; this file intentionally contains no independent prompt
 * registry or provider-specific instruction set.
 */
function promptFor(key: AssessmentContractKey, options: { detailedWritingAnalysis?: boolean } = {}): string {
  const contract = getAssessmentContract(key);
  if (!contract) throw new Error("assessment_contract_unavailable");
  return composeAssessmentPrompt({ contract, detailedWritingAnalysis: options.detailedWritingAnalysis });
}

export const instructions = promptFor("writing.task2.generic");

/** Grade My Work uses the same task contract plus the strict W7 output annex. */
export function writingGradeInstructions(task: "task1" | "task2"): string {
  return promptFor(task === "task1" ? "writing.grade.task1" : "writing.grade.task2", { detailedWritingAnalysis: true });
}

/** Kept for legacy provider metadata callers; resolver provenance uses task versions. */
export const CHECK_VERSIONS = {
  promptVersion: "writing-check-legacy-v1",
  rubricVersion: "writing-check-rubric-legacy-v1",
};

/** Writing workspace checks resolve to their own registered task contract. */
export function writingCheckInstructions(kind: "translation" | "activation" | "pattern", mode = "writing"): string {
  const key: AssessmentContractKey = kind === "translation" ? "writing.check.translation"
    : kind === "activation" ? mode === "speaking" ? "writing.check.activation-speaking" : "writing.check.activation-writing"
      : "writing.check.pattern-adaptation";
  return promptFor(key);
}
