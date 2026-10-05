import { defineAssessmentContracts, type AssessmentContractKey, type AssessmentContractSeed } from "./types";

export const LISTENING_DOMAIN_RULES = `LISTENING DOMAIN
- Listening grading is objective and server-owned. The persisted question or approved package supplies the official answer; a model may not change the result or reveal an answer key before submission.
- Multiple-choice answers are exact selections. Short answers use only the existing deterministic comparison and source-authored accepted forms; no model-created synonym or partial credit.
- Audio assets, question order, package scoring, and attempt completion are resolved by the server. If a source asset or official key is absent, report the limitation rather than substituting a guessed answer.`;

function listening(key: AssessmentContractKey, purpose: string, taskRules: string): AssessmentContractSeed {
  return { key, domain: "listening", execution: "objective_local", scoringMode: "objective_exact_match", purpose, taskRules, ownerOverlayFields: [] };
}

export const listeningContracts = defineAssessmentContracts([
  listening("listening.multiple-choice", "IELTS Listening multiple-choice objective question.", "Compare the selected option only with the persisted official answer or deterministic package result. Never infer or disclose the hidden correct option before the attempt is submitted."),
  listening("listening.short-answer", "IELTS Listening short-answer objective question.", "Use the existing exact normalization and server-authored accepted forms only. Do not add fuzzy matching, semantic alternatives, or partial credit."),
] as const);
