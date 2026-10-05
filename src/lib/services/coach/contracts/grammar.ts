import { defineAssessmentContracts, OWNER_OVERLAY_FIELDS_BY_DOMAIN, type AssessmentContractKey, type AssessmentContractSeed } from "./types";

export const GRAMMAR_DOMAIN_RULES = `GRAMMAR DOMAIN
- Judge the learner's produced language against the server-supplied item, target structure, and trusted authored answer/explanation. The sample answer is evidence about the intended structure, not the only acceptable wording.
- Separate a real grammar error from a different but valid construction. Do not invent an error solely because the learner's sentence differs from the sample.
- Multiple-choice and authored structure-checklist activities stay deterministic. The provider contract is only for free-text production when the application routes it here.`;

const fields = OWNER_OVERLAY_FIELDS_BY_DOMAIN.grammar;
function grammar(key: AssessmentContractKey, purpose: string, taskRules: string): AssessmentContractSeed {
  return { key, domain: "grammar", execution: "coach_evaluation", scoringMode: "verdict", purpose, taskRules, ownerOverlayFields: fields };
}

export const grammarContracts = defineAssessmentContracts([
  grammar("grammar.correct-it", "Free-text correction of an authored grammar item.", "Identify only a supported correction in the learner's answer. Preserve the intended meaning and explain the smallest useful change; do not mark a valid alternative wrong."),
  grammar("grammar.translate-it", "Translation into English when a deterministic authored-structure check cannot decide the result.", "Use the Uzbek source prompt and target structures supplied by the server. Accept natural translations that express the meaning and demonstrate the structure; never use exact sentence equality as the only criterion."),
  grammar("grammar.activate-it", "A learner-created sentence that activates a target grammar structure.", "Check whether the target structure appears in a meaningful, sufficiently complete sentence. Assess the sentence itself, not pronunciation or imagined spoken delivery."),
] as const);
