/**
 * Canonical, server-owned task contracts for Coach/RIWI. These keys are never
 * accepted from a learner request; services select them from persisted task
 * metadata and the resolver validates them again before provider dispatch.
 */
export const ASSESSMENT_CONTRACT_KEYS = [
  "writing.task1.generic",
  "writing.task1.line-chart",
  "writing.task1.bar-chart",
  "writing.task1.pie-chart",
  "writing.task1.table",
  "writing.task1.process",
  "writing.task1.map",
  "writing.task1.mixed",
  "writing.task2.generic",
  "writing.task2.opinion",
  "writing.task2.discussion",
  "writing.task2.advantages-disadvantages",
  "writing.task2.problem-solution",
  "writing.task2.two-part",
  "writing.task2.cause-effect",
  "writing.grade.task1",
  "writing.grade.task2",
  "writing.check.translation",
  "writing.check.activation-writing",
  "writing.check.activation-speaking",
  "writing.check.pattern-adaptation",
  "speaking.part1",
  "speaking.part2",
  "speaking.part3",
  "speaking.general",
  "speaking.mock",
  "speaking.shadowing",
  "speaking.top-structures",
  "grammar.correct-it",
  "grammar.translate-it",
  "grammar.activate-it",
  "vocabulary.recognition",
  "vocabulary.review",
  "vocabulary.retrieval",
  "vocabulary.collocation",
  "vocabulary.word-form",
  "vocabulary.use-in-sentence",
  "vocabulary.activation",
  "reading.true-false-not-given",
  "reading.yes-no-not-given",
  "reading.multiple-choice",
  "reading.short-answer",
  "listening.multiple-choice",
  "listening.short-answer",
  "assignment.objective-choice",
  "assignment.writing-linked",
  "assignment.free-form",
  "reporting.progress",
  "reporting.progress-explanation",
  "reporting.strengths",
  "reporting.priorities",
  "reporting.teacher-roster",
  "reporting.centre-metrics",
  "reporting.historical-window",
  "coaching.grammar-explanation",
  "coaching.grammar-rule-transfer",
  "coaching.vocabulary-explanation",
  "coaching.vocabulary-word-family",
  "coaching.writing-feedback-explanation",
  "coaching.speaking-feedback-explanation",
  "coaching.reading-strategy-explanation",
  "coaching.listening-strategy-explanation",
  "coaching.study-plan",
  "coaching.self-correction",
  "coaching.reflection",
  "coaching.word-choice",
  "coaching.task-planning",
  "coaching.error-pattern-review",
] as const;

export type AssessmentContractKey = (typeof ASSESSMENT_CONTRACT_KEYS)[number];
export type ContractDomain =
  | "writing"
  | "speaking"
  | "grammar"
  | "vocabulary"
  | "reading"
  | "listening"
  | "assignment"
  | "reporting"
  | "coaching";
export type ContractExecution =
  | "coach_evaluation"
  | "objective_local"
  | "deterministic_report"
  | "instruction_catalog";
export type ContractScoringMode =
  | "writing_band_estimate"
  | "speaking_band_estimate"
  | "verdict"
  | "objective_exact_match"
  | "deterministic_metrics"
  | "instruction_only";

export type AssessmentOwnerOverlay = {
  feedbackStyle?: "concise" | "balanced" | "step_by_step";
  explanationDepth?: "simple" | "standard" | "detailed";
  learnerTone?: "encouraging" | "direct" | "coach_explanatory";
  maxStrengths?: number;
  maxWeaknesses?: number;
  maxNextActions?: number;
  exampleCount?: number;
  useMiniIllustrations?: boolean;
  prioritizeBandLimitingIssues?: boolean;
  evidenceRequired?: boolean;
  includeCorrections?: boolean;
  includeReusableRule?: boolean;
  showPerAnswerScore?: boolean;
  topicSummary?: boolean;
  topicSummaryMaxWeaknesses?: number;
  feedbackUnit?: "per_answer" | "per_topic";
};

export type AssessmentOwnerOverlayField = keyof AssessmentOwnerOverlay;

export type AssessmentContractDefinition = {
  key: AssessmentContractKey;
  domain: ContractDomain;
  version: string;
  rubricVersion: string;
  execution: ContractExecution;
  scoringMode: ContractScoringMode;
  purpose: string;
  taskRules: string;
  ownerOverlayFields: readonly AssessmentOwnerOverlayField[];
};

export type AssessmentContractSeed = Omit<AssessmentContractDefinition, "version" | "rubricVersion">;

/**
 * Per-task version labels are deterministic and unique. Short, readable keys
 * retain labels such as `writing-task2-opinion-v1`; long keys are shortened
 * with a stable hash so all provenance fits the existing 40-character column.
 */
export function defineAssessmentContracts(
  seeds: readonly AssessmentContractSeed[],
): AssessmentContractDefinition[] {
  return seeds.map((seed) => {
    const slug = seed.key.replaceAll(".", "-");
    const hash = stableKeyHash(seed.key);
    const version = slug.length <= 37 ? `${slug}-v1` : `${slug.slice(0, 30)}-${hash.slice(0, 4)}-v1`;
    const rubricVersion = `rb-${hash.slice(0, 12)}-v1`;
    return { ...seed, version, rubricVersion };
  });
}

function stableKeyHash(value: string): string {
  // Small deterministic FNV-1a tag for version naming; not used as a security hash.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const ASSESSMENT_POLICY_SCOPES = [
  ...ASSESSMENT_CONTRACT_KEYS,
  "writing.task1.*",
  "writing.task2.*",
  "writing.*",
  "speaking.*",
  "grammar.*",
  "vocabulary.*",
  "reading.*",
  "listening.*",
  "assignment.*",
  "reporting.*",
  "coaching.*",
] as const;
export type AssessmentPolicyScope = (typeof ASSESSMENT_POLICY_SCOPES)[number];

export const OWNER_OVERLAY_FIELDS_BY_DOMAIN: Readonly<Record<ContractDomain, readonly AssessmentOwnerOverlayField[]>> = {
  writing: [
    "feedbackStyle", "explanationDepth", "learnerTone", "maxStrengths", "maxWeaknesses",
    "maxNextActions", "exampleCount", "useMiniIllustrations", "prioritizeBandLimitingIssues",
    "evidenceRequired", "includeCorrections", "includeReusableRule",
  ],
  speaking: [
    "feedbackStyle", "explanationDepth", "learnerTone", "maxStrengths", "maxWeaknesses",
    "maxNextActions", "exampleCount", "useMiniIllustrations", "evidenceRequired",
    "showPerAnswerScore", "topicSummary", "topicSummaryMaxWeaknesses", "feedbackUnit",
  ],
  grammar: [
    "feedbackStyle", "explanationDepth", "learnerTone", "maxStrengths", "maxWeaknesses",
    "maxNextActions", "exampleCount", "useMiniIllustrations", "evidenceRequired",
    "includeCorrections", "includeReusableRule",
  ],
  vocabulary: [
    "feedbackStyle", "explanationDepth", "learnerTone", "maxStrengths", "maxWeaknesses",
    "maxNextActions", "exampleCount", "useMiniIllustrations", "evidenceRequired",
    "includeCorrections", "includeReusableRule",
  ],
  reading: [],
  listening: [],
  assignment: ["feedbackStyle", "explanationDepth", "learnerTone", "maxStrengths", "maxWeaknesses", "maxNextActions"],
  reporting: [],
  coaching: ["feedbackStyle", "explanationDepth", "learnerTone", "exampleCount", "useMiniIllustrations", "includeCorrections", "includeReusableRule"],
};
