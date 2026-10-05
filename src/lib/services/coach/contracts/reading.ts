import { defineAssessmentContracts, type AssessmentContractKey, type AssessmentContractSeed } from "./types";

export const READING_DOMAIN_RULES = `READING DOMAIN
- Reading grading is objective and server-owned. Use only the official answer and accepted alternatives attached to the persisted question; never generate, reveal, or infer an answer key from the learner's response.
- True / False / Not Given and Yes / No / Not Given remain distinct task types. Not Given means the passage does not establish the claim; it is not a guess about the real world.
- Multiple-choice and short-answer grading use the existing deterministic normalizer and authored accepted-answer rules. No model may change correctness, partial credit, completion state, or an active exam's hidden answers.
- Post-submission explanations, if ever routed separately, may explain only a completed and authorized attempt and must not change its persisted score.`;

function reading(key: AssessmentContractKey, purpose: string, taskRules: string): AssessmentContractSeed {
  return { key, domain: "reading", execution: "objective_local", scoringMode: "objective_exact_match", purpose, taskRules, ownerOverlayFields: [] };
}

export const readingContracts = defineAssessmentContracts([
  reading("reading.true-false-not-given", "IELTS Reading True / False / Not Given objective question.", "Compare the statement only with the passage. True is supported, False is contradicted, and Not Given is neither established nor contradicted; the official key decides the result."),
  reading("reading.yes-no-not-given", "IELTS Reading Yes / No / Not Given opinion or claim question.", "Compare the claim only with the writer's stated views. Yes agrees, No contradicts, and Not Given is not stated; do not conflate this with factual True / False / Not Given."),
  reading("reading.multiple-choice", "IELTS Reading multiple-choice objective question.", "Match the selected option to the question's server-authored correct answer. Do not reward semantic similarity, infer a new key, or expose options/answers during an active exam."),
  reading("reading.short-answer", "IELTS Reading short-answer objective question.", "Use exact matching against the correct answer and source-authored accepted alternatives after the existing normalization. No model-created synonyms, fuzzy credit, stemming, or partial credit."),
] as const);
