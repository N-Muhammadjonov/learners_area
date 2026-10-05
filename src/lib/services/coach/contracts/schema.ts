import { z } from "zod";
import { ASSESSMENT_CONTRACT_KEYS, ASSESSMENT_POLICY_SCOPES } from "./types";

export const assessmentContractKeySchema = z.enum(ASSESSMENT_CONTRACT_KEYS);
export const assessmentPolicyScopeSchema = z.enum(ASSESSMENT_POLICY_SCOPES);

/** Strict presentation-only policy. No free-form prompt, score, safety, URL, tool, or answer-key field exists. */
export const assessmentOwnerOverlaySchema = z.object({
  feedbackStyle: z.enum(["concise", "balanced", "step_by_step"]).optional(),
  explanationDepth: z.enum(["simple", "standard", "detailed"]).optional(),
  learnerTone: z.enum(["encouraging", "direct", "coach_explanatory"]).optional(),
  maxStrengths: z.number().int().min(0).max(6).optional(),
  maxWeaknesses: z.number().int().min(0).max(6).optional(),
  maxNextActions: z.number().int().min(0).max(6).optional(),
  exampleCount: z.number().int().min(0).max(4).optional(),
  useMiniIllustrations: z.boolean().optional(),
  prioritizeBandLimitingIssues: z.boolean().optional(),
  evidenceRequired: z.boolean().optional(),
  includeCorrections: z.boolean().optional(),
  includeReusableRule: z.boolean().optional(),
  showPerAnswerScore: z.boolean().optional(),
  topicSummary: z.boolean().optional(),
  topicSummaryMaxWeaknesses: z.number().int().min(0).max(3).optional(),
  feedbackUnit: z.enum(["per_answer", "per_topic"]).optional(),
}).strict();

export const nonEmptyAssessmentOwnerOverlaySchema = assessmentOwnerOverlaySchema.refine(
  (overlay) => Object.keys(overlay).length > 0,
  { message: "overlay_must_change_an_allowed_presentation_field" },
);

export const assessmentPolicyCandidateSchema = z.object({
  scope: assessmentPolicyScopeSchema,
  overlay: nonEmptyAssessmentOwnerOverlaySchema,
}).strict();

export const assessmentContractContextSchema = z.object({
  key: assessmentContractKeySchema,
  version: z.string().min(1).max(40),
  rubricVersion: z.string().min(1).max(40),
  policyScope: assessmentPolicyScopeSchema.nullable(),
  policyVersion: z.number().int().positive().max(1_000_000).nullable(),
  overlay: assessmentOwnerOverlaySchema.nullable(),
}).strict();

export type AssessmentOwnerOverlayValue = z.infer<typeof assessmentOwnerOverlaySchema>;
