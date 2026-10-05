import type { EvaluationRequest } from "../resolver";
import type { GrammarEvaluationInput, SpeakingEvaluationInput, VocabularyEvaluationInput, WritingEvaluationInput } from "../types";
import { assignmentContracts } from "./assignment";
import { coachingContracts } from "./coaching";
import { grammarContracts } from "./grammar";
import { listeningContracts } from "./listening";
import { readingContracts } from "./reading";
import { reportingContracts } from "./reporting";
import { speakingContracts } from "./speaking";
import { vocabularyContracts } from "./vocabulary";
import { writingContracts } from "./writing";
import { assessmentContractKeySchema } from "./schema";
import type { AssessmentContractDefinition, AssessmentContractKey, AssessmentPolicyScope } from "./types";

/** The single task-contract registry. It is not a provider registry. */
export const assessmentContracts: readonly AssessmentContractDefinition[] = Object.freeze([
  ...writingContracts,
  ...speakingContracts,
  ...grammarContracts,
  ...vocabularyContracts,
  ...readingContracts,
  ...listeningContracts,
  ...assignmentContracts,
  ...reportingContracts,
  ...coachingContracts,
]);

const contractMap = new Map<AssessmentContractKey, AssessmentContractDefinition>();
for (const contract of assessmentContracts) {
  if (contractMap.has(contract.key)) throw new Error(`duplicate_assessment_contract:${contract.key}`);
  if (contract.version.length > 40 || contract.rubricVersion.length > 40) throw new Error(`assessment_version_too_long:${contract.key}`);
  contractMap.set(contract.key, contract);
}

export function getAssessmentContract(key: string): AssessmentContractDefinition | null {
  const parsed = assessmentContractKeySchema.safeParse(key);
  return parsed.success ? contractMap.get(parsed.data) ?? null : null;
}

export function getAssessmentContractOrThrow(key: string): AssessmentContractDefinition {
  const contract = getAssessmentContract(key);
  if (!contract) throw new Error("assessment_contract_unavailable");
  return contract;
}

export function isAssessmentContractKey(value: string): value is AssessmentContractKey {
  return contractMap.has(value as AssessmentContractKey);
}

function normalizedCategory(category: string | null | undefined): string {
  return (category ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-").replace(/-+/g, "-");
}

const TASK1_CATEGORY_KEYS: Readonly<Record<string, AssessmentContractKey>> = {
  "line-chart": "writing.task1.line-chart", "line-graph": "writing.task1.line-chart", line: "writing.task1.line-chart",
  "bar-chart": "writing.task1.bar-chart", "bar-graph": "writing.task1.bar-chart", bar: "writing.task1.bar-chart",
  "pie-chart": "writing.task1.pie-chart", pie: "writing.task1.pie-chart",
  table: "writing.task1.table", "data-table": "writing.task1.table",
  process: "writing.task1.process", diagram: "writing.task1.process", "flow-chart": "writing.task1.process",
  map: "writing.task1.map", maps: "writing.task1.map",
  mixed: "writing.task1.mixed", "mixed-chart": "writing.task1.mixed", "multiple-charts": "writing.task1.mixed",
};
const TASK2_CATEGORY_KEYS: Readonly<Record<string, AssessmentContractKey>> = {
  opinion: "writing.task2.opinion", "agree-disagree": "writing.task2.opinion", "agree-or-disagree": "writing.task2.opinion",
  discussion: "writing.task2.discussion", "discuss-both-views": "writing.task2.discussion", "discussion-essay": "writing.task2.discussion",
  "advantages-disadvantages": "writing.task2.advantages-disadvantages", "advantage-disadvantage": "writing.task2.advantages-disadvantages", "pros-cons": "writing.task2.advantages-disadvantages",
  "problem-solution": "writing.task2.problem-solution", "problems-solutions": "writing.task2.problem-solution",
  "two-part": "writing.task2.two-part", "double-question": "writing.task2.two-part", "two-question": "writing.task2.two-part",
  "cause-effect": "writing.task2.cause-effect", "causes-effects": "writing.task2.cause-effect",
};

export function writingContractKey(taskType: "task1" | "task2", category?: string | null): AssessmentContractKey {
  const normalized = normalizedCategory(category);
  const mapped = taskType === "task1" ? TASK1_CATEGORY_KEYS[normalized] : TASK2_CATEGORY_KEYS[normalized];
  return mapped ?? (taskType === "task1" ? "writing.task1.generic" : "writing.task2.generic");
}

export function speakingContractKey(part: "part1" | "part2" | "part3" | "general" | "mock"): AssessmentContractKey {
  return `speaking.${part}` as AssessmentContractKey;
}

export function grammarContractKey(activity: "correct_it" | "translate_it" | "activate_it"): AssessmentContractKey {
  return activity === "translate_it" ? "grammar.translate-it"
    : activity === "correct_it" ? "grammar.correct-it" : "grammar.activate-it";
}

function isWritingInput(input: unknown): input is WritingEvaluationInput {
  return Boolean(input && typeof input === "object" && (input as { taskType?: unknown }).taskType === "task1"
    || input && typeof input === "object" && (input as { taskType?: unknown }).taskType === "task2");
}
function isSpeakingInput(input: unknown): input is SpeakingEvaluationInput {
  return Boolean(input && typeof input === "object" && ["part1", "part2", "part3", "general", "mock"].includes(String((input as { part?: unknown }).part)));
}
function isGrammarInput(input: unknown): input is GrammarEvaluationInput {
  return Boolean(input && typeof input === "object" && typeof (input as { promptText?: unknown }).promptText === "string");
}
function isVocabularyInput(input: unknown): input is VocabularyEvaluationInput {
  return Boolean(input && typeof input === "object" && typeof (input as { targetWord?: unknown }).targetWord === "string");
}

export function assessmentContractKeyForRequest(request: EvaluationRequest): AssessmentContractKey {
  if (request.assessmentContractKey) return request.assessmentContractKey;
  switch (request.evaluationType) {
    case "writing": {
      const input = request.input;
      if (input.check?.kind === "translation") return "writing.check.translation";
      if (input.check?.kind === "activation") return input.check.mode === "speaking" ? "writing.check.activation-speaking" : "writing.check.activation-writing";
      if (input.check?.kind === "pattern") return "writing.check.pattern-adaptation";
      const category = (input as WritingEvaluationInput & { category?: string | null }).category;
      if (input.detailedAnalysis && !category) return input.taskType === "task1" ? "writing.grade.task1" : "writing.grade.task2";
      return writingContractKey(input.taskType, category);
    }
    case "speaking": {
      const input = request.input;
      if (!isSpeakingInput(input)) return "speaking.general";
      if (input.part === "mock") return "speaking.mock";
      return `speaking.${input.part}` as AssessmentContractKey;
    }
    case "grammar": {
      const input = request.input as GrammarEvaluationInput & { activity?: string };
      if (!isGrammarInput(input)) return "grammar.activate-it";
      if (input.activity === "translate_it") return "grammar.translate-it";
      if (input.activity === "correct_it") return "grammar.correct-it";
      return "grammar.activate-it";
    }
    case "vocabulary": {
      const input = request.input as VocabularyEvaluationInput & { taskKind?: string };
      if (!isVocabularyInput(input)) return "vocabulary.use-in-sentence";
      if (input.taskKind === "collocation") return "vocabulary.collocation";
      if (input.taskKind === "word-form") return "vocabulary.word-form";
      if (input.taskKind === "activation") return "vocabulary.activation";
      return "vocabulary.use-in-sentence";
    }
    case "assignment":
      return "assignment.free-form";
  }
  return "assignment.free-form";
}

export function assessmentContractForRequest(request: EvaluationRequest): AssessmentContractDefinition | null {
  return getAssessmentContract(assessmentContractKeyForRequest(request));
}

export function assessmentPolicyScopeMatches(scope: AssessmentPolicyScope, key: AssessmentContractKey): boolean {
  if (scope === key) return true;
  if (!scope.endsWith(".*")) return false;
  return key.startsWith(scope.slice(0, -1));
}

export function assessmentContractsForScope(scope: AssessmentPolicyScope): AssessmentContractDefinition[] {
  return assessmentContracts.filter((contract) => assessmentPolicyScopeMatches(scope, contract.key));
}
