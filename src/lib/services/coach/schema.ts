import { z } from "zod";
import { assessmentContractKeySchema, assessmentPolicyScopeSchema } from "./contracts/schema";

/**
 * The Coach contract.
 *
 * Everything in this file is the *application-level* shape of an evaluation.
 * Vendor-specific payloads live inside each provider adapter and are converted
 * into these schemas there. Nothing downstream of a provider — persistence,
 * UI, weakness tracking, progress — is allowed to know a vendor's structure.
 */

export const providerCapabilitySchema = z.enum([
  "text-evaluation",
  "writing-evaluation",
  "speaking-evaluation",
  "grammar-evaluation",
  "vocabulary-evaluation",
  "assignment-evaluation",
  "audio-input",
  "speech-to-text",
  "pronunciation",
  "vision",
  "structured-output",
  "riwi-assistant",
  "instruction-teaching",
]);

export const providerTypeSchema = z.enum(["internal", "external"]);

export const evaluationTypeSchema = z.enum([
  "writing",
  "speaking",
  "grammar",
  "vocabulary",
  "assignment",
]);

/**
 * Canonical weakness categories. Both RIWI and any external evaluator must
 * report into this one vocabulary: the learner's weakness history is shared,
 * never provider-specific.
 */
export const weaknessCategorySchema = z.enum([
  "GRAMMAR_ARTICLE",
  "GRAMMAR_SVA",
  "GRAMMAR_TENSE",
  "GRAMMAR_PREPOSITION",
  "GRAMMAR_FRAGMENT",
  "GRAMMAR_PUNCTUATION",
  "WRITING_TASK_RESPONSE",
  "WRITING_COHESION",
  "WRITING_LEXICAL_REPETITION",
  "WRITING_LENGTH",
  "SPEAKING_FILLERS",
  "SPEAKING_FLUENCY",
  "SPEAKING_SHORT_RESPONSE",
  "SPEAKING_REPETITION",
  "VOCAB_COLLOCATION",
  "VOCAB_WRONG_FORM",
  "VOCAB_NOT_USED",
]);

export const criterionSchema = z
  .object({
    key: z.string().min(1).max(40),
    label: z.string().min(1).max(120),
    band: z.number().min(0).max(9).nullable(),
    /**
     * True when the provider genuinely cannot judge this criterion. RIWI sets
     * it for pronunciation: scoring pronunciation from a transcript would be
     * fabrication. A limited criterion is displayed as such, never as a band.
     */
    limited: z.boolean().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

export const evaluationIssueSchema = z
  .object({
    category: weaknessCategorySchema,
    message: z.string().min(1).max(400),
    excerpt: z.string().max(300).nullable().optional(),
    suggestion: z.string().max(400).nullable().optional(),
    severity: z.enum(["low", "medium", "high"]),
  })
  .strict();

export const recommendedExerciseSchema = z
  .object({
    kind: z.enum(["writing", "speaking", "grammar", "vocabulary", "reading", "listening"]),
    label: z.string().min(1).max(160),
    href: z.string().max(300).nullable().optional(),
    reason: z.string().max(300).nullable().optional(),
  })
  .strict();

/**
 * What a provider is allowed to return. Validated with `.strict()` on purpose:
 * an external provider that adds vendor fields, renames a criterion or returns
 * a nested vendor object fails validation, which the resolver treats as a
 * provider failure and falls back to RIWI. Malformed provider output can never
 * be persisted as student feedback.
 */
export const evaluationVerdictSchema = z.enum(["correct", "mostly_correct", "needs_correction"]);

/**
 * Grade My Work detail (owner spec §42.5), bilingual so the UZ / EN switch
 * never re-grades. Strict and capped; persisted in writing_grade_requests,
 * never inside the evaluation row (which stays the band authority).
 */
const bilingual = (max: number) => z.object({ en: z.string().min(1).max(max), uz: z.string().min(1).max(max) }).strict();
export const writingAnalysisSchema = z
  .object({
    examinerComment: bilingual(1200),
    criterionNarratives: z.array(z.object({
      key: z.string().min(1).max(40),
      narrative: bilingual(900),
      evidence: z.array(z.string().min(1).max(300)).max(3),
    }).strict()).max(4),
    sentenceFeedback: z.array(z.object({
      index: z.number().int().min(1).max(200),
      original: z.string().min(1).max(600),
      improved: z.string().min(1).max(600),
      note: bilingual(400),
      categories: z.array(z.string().min(1).max(40)).max(3),
    }).strict()).max(12),
    topFixes: z.array(z.object({
      title: bilingual(120),
      explanation: bilingual(500),
      examples: z.array(z.string().min(1).max(300)).max(3),
    }).strict()).max(3),
  })
  .strict();
export type WritingAnalysis = z.infer<typeof writingAnalysisSchema>;

/** Optional evidence-first explanation shared by evaluator providers. */
export const teachingFeedbackSchema = z.object({
  simpleExplanation: z.string().max(1200).nullable(),
  evidence: z.array(z.object({
    excerpt: z.string().min(1).max(300),
    point: z.string().min(1).max(400),
    correction: z.string().max(400).nullable(),
  }).strict()).max(6),
  steps: z.array(z.string().min(1).max(300)).max(6),
  examples: z.array(z.object({
    before: z.string().max(300).nullable(),
    after: z.string().min(1).max(300),
    explanation: z.string().max(300).nullable(),
  }).strict()).max(4),
  illustration: z.string().max(1200).nullable(),
}).strict();
export type TeachingFeedback = z.infer<typeof teachingFeedbackSchema>;

export const providerEvaluationOutputSchema = z
  .object({
    overallEstimate: z.number().min(0).max(9).nullable(),
    confidence: z.number().min(0).max(1),
    /**
     * Used by the non-band evaluations (grammar, vocabulary, free-form
     * assignment): a verdict a learner can act on. Null for band-scale writing
     * and speaking, where `overallEstimate` carries the result instead.
     */
    verdict: evaluationVerdictSchema.nullable(),
    criteria: z.array(criterionSchema).max(12),
    strengths: z.array(z.string().min(1).max(400)).max(12),
    weaknesses: z.array(z.string().min(1).max(400)).max(12),
    issues: z.array(evaluationIssueSchema).max(30),
    nextActions: z.array(z.string().min(1).max(400)).max(12),
    recommendedExercises: z.array(recommendedExerciseSchema).max(8),
    /** Only Grade My Work asks for it; persisted separately from the band authority. */
    writingAnalysis: writingAnalysisSchema.optional(),
    /** Optional evidence-first teaching presentation; its excerpts are source-validated. */
    teachingFeedback: teachingFeedbackSchema.optional(),
  })
  .strict();

/**
 * Who actually produced the final result. `promptVersion` and `rubricVersion`
 * are tracked so a future change to the evaluation logic never rewrites the
 * meaning of a historical evaluation.
 */
/** Minimal plain-language answer from the optional RIWI assistant adapter. */
export const riwiAnswerSchema = z.object({
  answer: z.string().min(1).max(6000),
  uncertainty: z.string().max(600).nullable(),
  citations: z.array(z.string().regex(/^K[1-5]$/)).max(5),
}).strict();

export const evaluationProviderMetadataSchema = z
  .object({
    providerId: z.string().min(1).max(60),
    providerDisplayName: z.string().min(1).max(80),
    providerType: providerTypeSchema,
    providerVersion: z.string().min(1).max(40),
    model: z.string().max(120).nullable(),
    promptVersion: z.string().min(1).max(40),
    rubricVersion: z.string().min(1).max(40),
  })
  .strict();

export const checkedBySchema = z
  .object({
    id: z.string().min(1).max(60),
    displayName: z.string().min(1).max(80),
    type: providerTypeSchema,
  })
  .strict();

export const evaluationResultSchema = z
  .object({
    evaluationId: z.string().min(1).max(80),
    evaluationType: evaluationTypeSchema,
    providerId: z.string().min(1).max(60),
    providerDisplayName: z.string().min(1).max(80),
    providerType: providerTypeSchema,
    providerVersion: z.string().min(1).max(40),
    model: z.string().max(120).nullable(),
    promptVersion: z.string().min(1).max(40),
    rubricVersion: z.string().min(1).max(40),
    /** Internal, server-derived task provenance. Optional only for historical callers. */
    assessmentContractKey: assessmentContractKeySchema.optional(),
    ownerPolicyScope: assessmentPolicyScopeSchema.nullable().optional(),
    ownerPolicyVersion: z.number().int().positive().max(1_000_000).nullable().optional(),
    fallbackUsed: z.boolean(),
    fallbackFrom: z.string().max(60).nullable(),
    checkedBy: checkedBySchema,
    overallEstimate: z.number().min(0).max(9).nullable(),
    confidence: z.number().min(0).max(1),
    verdict: evaluationVerdictSchema.nullable(),
    criteria: z.array(criterionSchema).max(12),
    strengths: z.array(z.string().min(1).max(400)).max(12),
    weaknesses: z.array(z.string().min(1).max(400)).max(12),
    issues: z.array(evaluationIssueSchema).max(30),
    nextActions: z.array(z.string().min(1).max(400)).max(12),
    recommendedExercises: z.array(recommendedExerciseSchema).max(8),
    teachingFeedback: teachingFeedbackSchema.optional(),
    processedInMs: z.number().int().min(0).max(600_000),
    createdAt: z.string().min(1).max(40),
  })
  .strict();

export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type ProviderType = z.infer<typeof providerTypeSchema>;
export type EvaluationType = z.infer<typeof evaluationTypeSchema>;
export type WeaknessCategory = z.infer<typeof weaknessCategorySchema>;
export type Criterion = z.infer<typeof criterionSchema>;
export type EvaluationIssue = z.infer<typeof evaluationIssueSchema>;
export type RecommendedExercise = z.infer<typeof recommendedExerciseSchema>;
export type EvaluationVerdict = z.infer<typeof evaluationVerdictSchema>;
export type ProviderEvaluationOutput = z.infer<typeof providerEvaluationOutputSchema>;
export type RiwiAnswer = z.infer<typeof riwiAnswerSchema>;
export type EvaluationProviderMetadata = z.infer<typeof evaluationProviderMetadataSchema>;
export type CheckedBy = z.infer<typeof checkedBySchema>;
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

/** The label every result must carry. Derived, never hardcoded in the UI. */
export function buildCheckedBy(meta: EvaluationProviderMetadata): CheckedBy {
  return { id: meta.providerId, displayName: meta.providerDisplayName, type: meta.providerType };
}
