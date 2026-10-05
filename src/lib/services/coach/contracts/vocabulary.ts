import { defineAssessmentContracts, OWNER_OVERLAY_FIELDS_BY_DOMAIN, type AssessmentContractKey, type AssessmentContractSeed } from "./types";

export const VOCABULARY_DOMAIN_RULES = `VOCABULARY DOMAIN
- Canonical Dictionary entries and their server-supplied definitions are the authority for target meaning. Never create or silently revise dictionary definitions.
- Keep recognition/review separate from active production. A target string appearing in a sentence is not by itself proof of correct use.
- Judge inflection, part of speech, collocation, and context only from the supplied target entry and learner sentence. Give no IELTS essay band for a single sentence.`;

const fields = OWNER_OVERLAY_FIELDS_BY_DOMAIN.vocabulary;
function vocabulary(key: AssessmentContractKey, purpose: string, taskRules: string, execution: AssessmentContractSeed["execution"] = "coach_evaluation"): AssessmentContractSeed {
  return { key, domain: "vocabulary", execution, scoringMode: execution === "coach_evaluation" ? "verdict" : "instruction_only", purpose, taskRules, ownerOverlayFields: fields };
}

export const vocabularyContracts = defineAssessmentContracts([
  vocabulary("vocabulary.recognition", "Recognize a canonical vocabulary item during review.", "Recognition is a learner memory signal, not proof of active production. This review path remains governed by the deterministic vocabulary engine; do not route it to an evaluator.", "instruction_catalog"),
  vocabulary("vocabulary.review", "Spaced-repetition review of a canonical vocabulary item.", "Use only the server-selected due item and its canonical definition. Review outcomes and scheduling are calculated by the deterministic vocabulary engine.", "instruction_catalog"),
  vocabulary("vocabulary.retrieval", "Recall a canonical word or phrase without revealing unrelated dictionary data.", "A retrieval attempt is evidence of recall only. The server owns the item, answer comparison, and mastery calculation; do not infer broader language ability.", "instruction_catalog"),
  vocabulary("vocabulary.collocation", "Explain a target word's canonical collocation and usage pattern.", "Use the supplied dictionary entry and learner sentence. Explain the actual word partnership; do not invent an authoritative dictionary entry or synonym list."),
  vocabulary("vocabulary.word-form", "Assess a target word's inflected or derived form in a learner sentence.", "Distinguish an acceptable inflection from an incorrect part of speech. If the intended form cannot be established from the supplied definition and sentence, state the limit."),
  vocabulary("vocabulary.use-in-sentence", "Assess active use of a canonical target word in the learner's own sentence.", "Confirm that the target is used as a word, in a plausible form and collocation, in a complete meaningful sentence. Do not award active-use credit for a copied fragment or mere string match."),
  vocabulary("vocabulary.activation", "Transfer a vocabulary item into a new learner-authored context.", "Evaluate only the new sentence and canonical target facts supplied by the server. Do not infer durable mastery from one attempt or change deterministic points/mastery rules."),
] as const);
