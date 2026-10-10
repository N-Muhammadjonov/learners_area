import { deriveOverall, normalizeWritingCriteria, criteriaFor, toHalfBand } from "@/lib/writing/grade-criteria";
import type { ProviderEvaluationOutput } from "../schema";
import { RETENTION_DOMAIN_RULES, TUTORING_DOMAIN_RULES } from "./prompt-book";
import { ASSIGNMENT_DOMAIN_RULES } from "./assignment";
import { COACHING_DOMAIN_RULES } from "./coaching";
import { GRAMMAR_DOMAIN_RULES, GRAMMAR_TRANSLATION_DOMAIN_RULES } from "./grammar";
import { LISTENING_DOMAIN_RULES } from "./listening";
import { READING_DOMAIN_RULES } from "./reading";
import { REPORTING_DOMAIN_RULES } from "./reporting";
import { SPEAKING_DOMAIN_RULES } from "./speaking";
import { VOCABULARY_DOMAIN_RULES } from "./vocabulary";
import { WRITING_DOMAIN_RULES } from "./writing";
import { GLOBAL_TEACHING_RULES, HARD_CORE_RULES, STRICT_OUTPUT_RULES } from "./core";
import { getAssessmentContract } from "./registry";
import { assessmentOwnerOverlaySchema } from "./schema";
import type { AssessmentContractDefinition, AssessmentOwnerOverlay } from "./types";

const DOMAIN_RULES = {
  writing: WRITING_DOMAIN_RULES,
  speaking: SPEAKING_DOMAIN_RULES,
  grammar: GRAMMAR_DOMAIN_RULES,
  vocabulary: VOCABULARY_DOMAIN_RULES,
  reading: READING_DOMAIN_RULES,
  listening: LISTENING_DOMAIN_RULES,
  assignment: ASSIGNMENT_DOMAIN_RULES,
  reporting: REPORTING_DOMAIN_RULES,
  coaching: COACHING_DOMAIN_RULES,
  retention: RETENTION_DOMAIN_RULES,
  tutoring: TUTORING_DOMAIN_RULES,
} as const;

export type AssessmentPromptOptions = {
  contract: AssessmentContractDefinition;
  overlay?: AssessmentOwnerOverlay | null;
  policyVersion?: number | null;
  detailedWritingAnalysis?: boolean;
};

/**
 * Compose in the only permitted order. Owner-controlled values are serialized
 * as a strict field map, never interpolated as instructions or prompt text.
 */
export function composeAssessmentPrompt(options: AssessmentPromptOptions): string {
  const { contract } = options;
  if (contract.execution !== "coach_evaluation") throw new Error("assessment_contract_not_provider_executable");
  const overlay = filterOwnerOverlay(contract, options.overlay ?? null);
  const domainRules = contract.key === "grammar.translate-assessed" ? GRAMMAR_TRANSLATION_DOMAIN_RULES : DOMAIN_RULES[contract.domain];
  const task = [
    `TASK CONTRACT: ${contract.key}`,
    `TASK CONTRACT VERSION: ${contract.version}`,
    `RUBRIC VERSION: ${contract.rubricVersion}`,
    `PURPOSE: ${contract.purpose}`,
    `TASK-SPECIFIC RULES: ${contract.taskRules}`,
    ...(options.detailedWritingAnalysis ? [`[GRADE MY WORK OUTPUT ANNEX]\n${gradeMyWorkRules(contract.key)}`] : []),
  ].join("\n");
  const sections = [
    `[IMMUTABLE HARD CORE]\n${HARD_CORE_RULES}`,
    `[GLOBAL TEACHING AND EVIDENCE]\n${GLOBAL_TEACHING_RULES}`,
    `[${contract.domain.toUpperCase()} DOMAIN CONTRACT]\n${domainRules}`,
    `[TASK-SPECIFIC CONTRACT]\n${task}`,
    `[APPROVED OWNER PRESENTATION OVERLAY]\n${overlay ? JSON.stringify({ version: options.policyVersion, fields: overlay }) : "No approved owner overlay is active."}`,
    `[STRICT OUTPUT RULES]\n${STRICT_OUTPUT_RULES}`,
  ];
  return sections.join("\n\n");
}

function gradeMyWorkRules(contractKey: string): string {
  const task = contractKey.includes("task1") ? "task1" : "task2";
  const keys = criteriaFor(task).join(", ");
  return `Grade My Work mode. Return exactly these four canonical criterion keys in this order: ${keys}. Every band is in 0.5 steps from 0 to 9; set limited=false and verdict=null. Include writingAnalysis with bilingual examinerComment; exactly four criterionNarratives with evidence quoted from the essay; sentenceFeedback containing only real errors and exact original sentences; and at most three topFixes, ordered by the most score-limiting issue. Any topFixes example must be an exact, bounded quote from the essay. Use Uzbek Latin script. The server is authoritative for criterion labels, band normalization, and overall calculation.`;
}

export function filterOwnerOverlay(
  contract: AssessmentContractDefinition,
  overlay: AssessmentOwnerOverlay | null,
): AssessmentOwnerOverlay | null {
  if (!overlay) return null;
  const parsed = assessmentOwnerOverlaySchema.safeParse(overlay);
  if (!parsed.success) return null;
  const allowed = new Set(contract.ownerOverlayFields);
  const filtered = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => allowed.has(key as keyof AssessmentOwnerOverlay)));
  const result = assessmentOwnerOverlaySchema.safeParse(filtered);
  return result.success && Object.keys(result.data).length > 0 ? result.data : null;
}

function sourceTextForInput(task: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (task === "writing" && value.check && typeof value.check === "object") {
    const check = value.check as Record<string, unknown>;
    return typeof check.answer === "string" ? check.answer : null;
  }
  const candidates = task === "writing" ? [value.content]
    : task === "writing_check" ? [value.answer]
      : task === "speaking" ? [value.transcript]
        : task === "grammar" ? [value.studentAnswer]
          : task === "vocabulary" ? [value.studentSentence]
            : task === "assignment" ? [value.studentResponse] : [];
  return candidates.find((candidate): candidate is string => typeof candidate === "string") ?? null;
}

/** Empty or oversized work is not evidence, even when a provider returns a
 * well-shaped score with no quotations. Apply before dispatch and again after
 * provider output, including internal/fallback evaluators. */
export function validateAssessmentInput(task: string, input: unknown): boolean {
  const limits: Record<string, number> = { writing: 20_000, writing_check: 20_000, speaking: 20_000, grammar: 10_000, vocabulary: 5000, assignment: 20_000 };
  const source = sourceTextForInput(task, input);
  if (!limits[task] || !source?.trim() || source.length > limits[task]!) return false;
  if (task === "writing" && input && typeof input === "object") {
    const value = input as Record<string, unknown>;
    // The provider grades check.answer; persistence must refer to that same work.
    if (value.check && value.content !== source) return false;
  }
  return true;
}

function exactEvidenceQuote(excerpt: string, source: string | null): boolean {
  if (!source) return false;
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const quote = normalize(excerpt);
  return quote.length > 0 && normalize(source).includes(quote);
}

function evidenceIsGrounded(task: string, input: unknown, output: ProviderEvaluationOutput): boolean {
  const source = sourceTextForInput(task, input);
  const allExcerpts = [
    ...output.issues.flatMap((issue) => issue.excerpt != null ? [issue.excerpt] : []),
    ...(output.teachingFeedback?.evidence.map((item) => item.excerpt) ?? []),
    ...(output.teachingFeedback?.examples.flatMap((item) => item.before !== null ? [item.before] : []) ?? []),
    ...(output.writingAnalysis?.criterionNarratives.flatMap((item) => item.evidence) ?? []),
    ...(output.writingAnalysis?.topFixes.flatMap((item) => item.examples) ?? []),
  ];
  if (output.writingAnalysis) allExcerpts.push(...output.writingAnalysis.sentenceFeedback.map((item) => item.original));
  return allExcerpts.every((excerpt) => exactEvidenceQuote(excerpt, source));
}

function normalizedWritingOutput(
  contract: AssessmentContractDefinition,
  input: unknown,
  output: ProviderEvaluationOutput,
): ProviderEvaluationOutput | null {
  if (!input || typeof input !== "object") return null;
  const request = input as Record<string, unknown>;
  const taskType = request.taskType === "task1" ? "task1" : request.taskType === "task2" ? "task2" : null;
  if (!taskType) return null;
  const check = request.check && typeof request.check === "object" ? request.check as Record<string, unknown> : null;
  if (check) {
    const kind = check.kind;
    const mode = check.mode;
    const checkContractKey = kind === "translation" ? "writing.check.translation"
      : kind === "activation" ? mode === "speaking" ? "writing.check.activation-speaking" : mode === "writing" ? "writing.check.activation-writing" : null
        : kind === "pattern" ? "writing.check.pattern-adaptation" : null;
    const expectedKeys = kind === "translation" ? ["meaning", "grammar", "vocabulary"]
      : kind === "activation" ? ["meaning", "form", "collocation", "naturalness", "grammar"]
        : kind === "pattern" ? ["grammar", "meaning", "pattern", "adaptation"] : null;
    if (!checkContractKey || contract.key !== checkContractKey || !expectedKeys
      || output.criteria.length !== expectedKeys.length
      || !expectedKeys.every((key, index) => output.criteria[index]?.key.toLowerCase() === key
        && output.criteria[index]?.band !== null && output.criteria[index]?.limited !== true)
      || output.overallEstimate !== null || output.verdict === null || output.writingAnalysis) return null;
    return output;
  }

  const matchesTask = contract.key === `writing.grade.${taskType}` || contract.key.startsWith(`writing.${taskType}.`);
  if (!matchesTask || (contract.key.startsWith("writing.grade.") && request.detailedAnalysis !== true)) return null;
  if (output.verdict !== null || output.criteria.length !== 4) return null;
  const normalized = normalizeWritingCriteria(taskType, output.criteria);
  if (!normalized) return null;
  const detailed = request.detailedAnalysis === true || contract.key.startsWith("writing.grade.");
  if (detailed) {
    const analysis = output.writingAnalysis;
    const keys = criteriaFor(taskType);
    const narrativeKeys = analysis?.criterionNarratives.map((item) => item.key) ?? [];
    const canonical = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
    if (!analysis || narrativeKeys.length !== keys.length
      || !keys.every((key, index) => canonical(narrativeKeys[index] ?? "") === canonical(key))
      || new Set(narrativeKeys.map(canonical)).size !== keys.length
      || analysis.criterionNarratives.some((item) => item.evidence.length === 0)) return null;
  } else if (output.writingAnalysis) {
    return null;
  }
  return { ...output, overallEstimate: normalized.overall, criteria: normalized.criteria.map((item) => ({
    key: item.key, label: item.label, band: item.band, limited: false, note: item.note,
  })) };
}

function speakingCriterionKey(key: string, label: string): "fluency" | "lexical" | "grammar" | null {
  const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
  const normalizedLabel = label.toLowerCase().replace(/[^a-z]/g, "");
  if (normalizedKey.includes("pronunciation") || normalizedLabel.includes("pronunciation")) return null;
  if (normalizedKey.includes("fluency") || normalizedLabel.includes("fluency")) return "fluency";
  if (normalizedKey.startsWith("lexical") || normalizedLabel.includes("lexicalresource")) return "lexical";
  if (normalizedKey.startsWith("grammar") || normalizedKey.startsWith("grammatical")
    || normalizedLabel.includes("grammaticalrangeandaccuracy")) return "grammar";
  return null;
}

const SPEAKING_CRITERION_LABELS = {
  fluency: "Fluency and Coherence",
  lexical: "Lexical Resource",
  grammar: "Grammatical Range and Accuracy",
} as const;

function speakingOutput(
  contract: AssessmentContractDefinition,
  input: unknown,
  output: ProviderEvaluationOutput,
): ProviderEvaluationOutput | null {
  if (!input || typeof input !== "object" || output.verdict !== null || output.writingAnalysis) return null;
  const request = input as Record<string, unknown>;
  const part = request.part;
  if (!("part1 part2 part3 general mock".split(" ").includes(String(part))) || contract.key !== `speaking.${String(part)}`) return null;
  const pronunciation = output.criteria.filter((item) => /pronunciation/i.test(`${item.key} ${item.label}`));
  if (pronunciation.length > 1 || (pronunciation[0] && (pronunciation[0].band !== null || pronunciation[0].limited !== true))) return null;
  const scored = output.criteria.filter((item) => !/pronunciation/i.test(`${item.key} ${item.label}`));
  if (scored.length !== 3) return null;
  const byKey = new Map<string, ProviderEvaluationOutput["criteria"][number]>();
  for (const item of scored) {
    const key = speakingCriterionKey(item.key, item.label);
    const band = item.limited === true ? null : toHalfBand(item.band);
    if (!key || band === null || byKey.has(key)) return null;
    byKey.set(key, { ...item, key, label: SPEAKING_CRITERION_LABELS[key], band, limited: false });
  }
  const ordered = (["fluency", "lexical", "grammar"] as const).map((key) => byKey.get(key));
  if (ordered.some((item) => !item)) return null;
  const criteria = [
    ...(ordered as NonNullable<(typeof ordered)[number]>[]),
    { key: "pronunciation", label: "Pronunciation", band: null, limited: true, note: "Audio pronunciation was not evaluated" },
  ];
  return {
    ...output,
    overallEstimate: deriveOverall((ordered as NonNullable<(typeof ordered)[number]>[]).map((item) => item.band!)),
    criteria,
  };
}

/** Shared task-specific validation/normalization for RIWI and every LLM provider. */
export function validateAssessmentOutput(
  contract: AssessmentContractDefinition,
  task: string,
  input: unknown,
  output: ProviderEvaluationOutput,
  overlay: AssessmentOwnerOverlay | null = null,
): ProviderEvaluationOutput | null {
  if (contract.execution !== "coach_evaluation" || contract.domain !== task || !validateAssessmentInput(task, input)) return null;
  let normalized = output;
  if (contract.domain === "writing") {
    const writing = normalizedWritingOutput(contract, input, output);
    if (!writing) return null;
    normalized = writing;
  } else if (contract.domain === "speaking") {
    const speaking = speakingOutput(contract, input, output);
    if (!speaking) return null;
    normalized = speaking;
  } else if (["grammar", "vocabulary", "assignment"].includes(contract.domain)) {
    if (output.overallEstimate !== null || output.verdict === null || output.writingAnalysis
      || output.criteria.some((criterion) => criterion.band !== null)) return null;
    if (contract.key === "grammar.translate-assessed") {
      const expected = ["meaning", "grammar", "target_structure"];
      if (output.criteria.length !== expected.length || new Set(output.criteria.map(criterion => criterion.key)).size !== expected.length
        || expected.some(key => !output.criteria.some(criterion => criterion.key === key && !criterion.limited))) return null;
    }
  } else {
    return null;
  }
  if (!evidenceIsGrounded(task, input, normalized)) return null;
  if (overlay?.evidenceRequired) {
    const excerpts = [
      ...normalized.issues.flatMap((issue) => issue.excerpt ? [issue.excerpt] : []),
      ...(normalized.teachingFeedback?.evidence.map((item) => item.excerpt) ?? []),
      ...(normalized.writingAnalysis?.criterionNarratives.flatMap((item) => item.evidence) ?? []),
      ...(normalized.writingAnalysis?.sentenceFeedback.map((item) => item.original) ?? []),
    ];
    if (!excerpts.some((excerpt) => excerpt.trim().length > 0)) return null;
  }
  return normalized;
}

function capArray<T>(values: T[], cap: number | undefined): T[] {
  return cap === undefined ? values : values.slice(0, cap);
}

/** Apply only safe presentation bounds; scores, rubric, keys and evidence are unchanged. */
export function applyOwnerOverlayToOutput(
  output: ProviderEvaluationOutput,
  overlay: AssessmentOwnerOverlay | null,
): ProviderEvaluationOutput {
  if (!overlay) return output;
  const issues = overlay.prioritizeBandLimitingIssues
    ? [...output.issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    : output.issues;
  const evidence = overlay.evidenceRequired
    ? output.teachingFeedback?.evidence.filter((item) => item.excerpt.trim().length > 0) ?? []
    : output.teachingFeedback?.evidence ?? [];
  const teachingFeedback = output.teachingFeedback ? {
    ...output.teachingFeedback,
    evidence: overlay.includeCorrections === false
      ? evidence.map((item) => ({ ...item, correction: null }))
      : evidence,
    examples: capArray(output.teachingFeedback.examples, overlay.exampleCount),
    ...(overlay.useMiniIllustrations === false ? { illustration: null } : {}),
  } : undefined;
  const writingAnalysis = output.writingAnalysis ? {
    ...output.writingAnalysis,
    ...(overlay.includeCorrections === false ? { sentenceFeedback: [] } : {}),
    topFixes: overlay.exampleCount === undefined ? output.writingAnalysis.topFixes : output.writingAnalysis.topFixes.map((fix) => ({ ...fix, examples: fix.examples.slice(0, overlay.exampleCount) })),
  } : undefined;
  return {
    ...output,
    strengths: capArray(output.strengths, overlay.maxStrengths),
    weaknesses: capArray(output.weaknesses, overlay.maxWeaknesses),
    nextActions: capArray(output.nextActions, overlay.maxNextActions),
    issues,
    ...(teachingFeedback ? { teachingFeedback } : {}),
    ...(writingAnalysis ? { writingAnalysis } : {}),
  };
}

function severityRank(severity: "low" | "medium" | "high"): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

/** Stable readable signature for regression evidence; no learner data is accepted here. */
export function promptInvariantSnapshot(key: string, overlay: AssessmentOwnerOverlay | null = null): Record<string, unknown> {
  const contract = getAssessmentContract(key);
  if (!contract) throw new Error("assessment_contract_unavailable");
  const composed = contract.execution === "coach_evaluation"
    ? composeAssessmentPrompt({ contract, overlay })
    : `${HARD_CORE_RULES}\n${GLOBAL_TEACHING_RULES}\n${DOMAIN_RULES[contract.domain]}\n${contract.taskRules}\n${STRICT_OUTPUT_RULES}`;
  return {
    key: contract.key,
    version: contract.version,
    rubricVersion: contract.rubricVersion,
    execution: contract.execution,
    hasHardCore: composed.includes(HARD_CORE_RULES),
    hasGlobalTeaching: composed.includes(GLOBAL_TEACHING_RULES),
    hasTaskRules: composed.includes(contract.taskRules),
    hasStrictOutput: composed.includes(STRICT_OUTPUT_RULES),
    rawOverlayPresent: overlay === null || composed.includes(JSON.stringify(filterOwnerOverlay(contract, overlay))),
  };
}
