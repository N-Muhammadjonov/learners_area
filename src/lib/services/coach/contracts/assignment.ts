import { defineAssessmentContracts, OWNER_OVERLAY_FIELDS_BY_DOMAIN, type AssessmentContractKey, type AssessmentContractSeed } from "./types";

export const ASSIGNMENT_DOMAIN_RULES = `ASSIGNMENT DOMAIN
- Dispatch from the server's linked task metadata, never from student wording. A linked Writing prompt uses the Writing contract; objective questions remain deterministically graded; only genuinely free-form responses use this contract.
- A free-form assignment gets a verdict and measured, relevant observations, not an invented IELTS band. Respect the assignment text and do not claim that it contains a rubric or expected answer when it does not.`;

const fields = OWNER_OVERLAY_FIELDS_BY_DOMAIN.assignment;
function assignment(key: AssessmentContractKey, purpose: string, taskRules: string, execution: AssessmentContractSeed["execution"], scoringMode: AssessmentContractSeed["scoringMode"]): AssessmentContractSeed {
  return { key, domain: "assignment", execution, scoringMode, purpose, taskRules, ownerOverlayFields: fields };
}

export const assignmentContracts = defineAssessmentContracts([
  assignment("assignment.objective-choice", "Objective assignment answer, graded by the authored answer key.", "The exact server-owned key is authoritative. This task is deterministic and must never be routed to a language model.", "objective_local", "objective_exact_match"),
  assignment("assignment.writing-linked", "Assignment linked to a persisted Writing prompt.", "Dispatch to the linked Writing task contract using the server-fetched prompt metadata. This catalog entry does not replace the Writing rubric or its score authority.", "instruction_catalog", "instruction_only"),
  assignment("assignment.free-form", "Free-form assignment response without a specialized linked task.", "Report only supported response facts and a bounded verdict. Do not issue an IELTS band, infer missing assignment requirements, or convert a teacher's unprovided rubric into a score.", "coach_evaluation", "verdict"),
] as const);
