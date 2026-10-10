import { defineAssessmentContracts, OWNER_OVERLAY_FIELDS_BY_DOMAIN, type AssessmentContractKey, type AssessmentContractSeed } from "./types";

/** Frozen published text is used only to verify old policy evidence hashes. */
export const HISTORICAL_GRAMMAR_DOMAIN_RULES = `GRAMMAR DOMAIN
- Judge the learner's produced language against the server-supplied item, target structure, and trusted authored answer/explanation. The sample answer is evidence about the intended structure, not the only acceptable wording.
- Separate a real grammar error from a different but valid construction. Do not invent an error solely because the learner's sentence differs from the sample.
- Multiple-choice and authored structure-checklist activities stay deterministic. The provider contract is only for free-text production when the application routes it here.`;

export const GRAMMAR_DOMAIN_RULES = HISTORICAL_GRAMMAR_DOMAIN_RULES;
export const GRAMMAR_TRANSLATION_DOMAIN_RULES = HISTORICAL_GRAMMAR_DOMAIN_RULES.replace(
  "- Multiple-choice and authored structure-checklist activities stay deterministic. The provider contract is only for free-text production when the application routes it here.",
  "- Multiple-choice activities stay deterministic. Authored phrase checklists are diagnostics: phrase presence cannot establish a translation's meaning or exclude a valid alternative. The provider contract is for free-text production when the application routes it here.",
);

const fields = OWNER_OVERLAY_FIELDS_BY_DOMAIN.grammar;
function grammar(key: AssessmentContractKey, purpose: string, taskRules: string): AssessmentContractSeed {
  return { key, domain: "grammar", execution: "coach_evaluation", scoringMode: "verdict", purpose, taskRules, ownerOverlayFields: fields };
}

export const historicalGrammarContracts = defineAssessmentContracts([
  grammar("grammar.correct-it", "Free-text correction of an authored grammar item.", "Identify only a supported correction in the learner's answer. Preserve the intended meaning and explain the smallest useful change; do not mark a valid alternative wrong."),
  grammar("grammar.translate-it", "Translation into English when a deterministic authored-structure check cannot decide the result.", "Use the Uzbek source prompt and target structures supplied by the server. Accept natural translations that express the meaning and demonstrate the structure; never use exact sentence equality as the only criterion."),
  grammar("grammar.activate-it", "A learner-created sentence that activates a target grammar structure.", "Check whether the target structure appears in a meaningful, sufficiently complete sentence. Assess the sentence itself, not pronunciation or imagined spoken delivery."),
] as const);

/** The new live contract does not replace any published v1 definition. */
export const grammarContracts = [...historicalGrammarContracts, ...defineAssessmentContracts([
  grammar("grammar.translate-assessed", "Meaning-preserving translation of the authored Uzbek prompt into English.", "Use the Uzbek source prompt and target structures supplied by the server. Accept natural translations that express the meaning and demonstrate the structure, including equivalent wording for authored cues. Never use exact sentence equality or phrase presence as the only criterion. Return exactly three criteria with keys meaning, grammar, target_structure; every band must be null and every criterion must be fully assessed (limited false). If any of these cannot be assessed, refuse evaluation rather than returning a verdict."),
])];
