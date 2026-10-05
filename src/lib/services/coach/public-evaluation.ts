import type { EvaluationRecord } from "@/lib/data/evaluations";
import { PUBLIC_CHECKED_BY } from "./attribution";

/**
 * The ONLY shape of an evaluation that may reach a learner (owner rule 2026-10-03,
 * spec §20–§22).
 *
 * `EvaluationRecord` legitimately carries the real evaluator identity —
 * provider id, display name, type, version, model, prompt/rubric versions and
 * the internal `checkedBy` — because owner audit needs it and it must never be
 * erased. That truth stays in the row and on staff surfaces.
 *
 * This module is the boundary. It is written as an explicit field-by-field
 * projection rather than a spread with deletions, so a field added to
 * `EvaluationRecord` in future cannot silently start leaking: anything not
 * named here simply does not exist in the output.
 *
 * `checkedBy` is the fixed public constant, so no env value or provider string
 * can reach a learner through this path even by accident.
 */

export type PublicCriterion = {
  key: string;
  label: string;
  /**
   * Null when the criterion was not genuinely assessed. A band is never
   * invented to fill the gap — the UI renders "Not assessed" instead (§23).
   */
  band: number | null;
  /** True when the provider could not judge this criterion at all. */
  limited: boolean;
  note: string | null;
};

export type PublicIssue = {
  category: string;
  message: string;
  excerpt: string | null;
  suggestion: string | null;
  severity: "low" | "medium" | "high";
};

export type PublicExercise = {
  kind: string;
  label: string;
  href: string | null;
  reason: string | null;
};

export type LearnerEvaluation = {
  id: string;
  /** Always the public constant. Never a provider or model name. */
  checkedBy: typeof PUBLIC_CHECKED_BY;
  /** Safe to show: says a local check ran, without naming what it fell back from. */
  fallbackUsed: boolean;
  overallEstimate: number | null;
  confidence: number;
  verdict: EvaluationRecord["verdict"];
  criteria: PublicCriterion[];
  strengths: string[];
  weaknesses: string[];
  issues: PublicIssue[];
  nextActions: string[];
  recommendedExercises: PublicExercise[];
  createdAt: string;
};

export function toLearnerEvaluation(record: EvaluationRecord): LearnerEvaluation {
  return {
    id: record.id,
    checkedBy: PUBLIC_CHECKED_BY,
    fallbackUsed: record.fallbackUsed,
    overallEstimate: record.overallEstimate,
    confidence: record.confidence,
    verdict: record.verdict,
    criteria: record.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      band: c.band,
      limited: c.limited ?? false,
      note: c.note ?? null,
    })),
    strengths: [...record.strengths],
    weaknesses: [...record.weaknesses],
    issues: record.issues.map((i) => ({
      category: i.category,
      message: i.message,
      excerpt: i.excerpt ?? null,
      suggestion: i.suggestion ?? null,
      severity: i.severity,
    })),
    nextActions: [...record.nextActions],
    recommendedExercises: record.recommendedExercises.map((e) => ({
      kind: e.kind,
      label: e.label,
      href: e.href ?? null,
      reason: e.reason ?? null,
    })),
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Field names that must never appear in a learner-facing payload. Exported so a
 * test can assert the projection really excludes them — the rule is enforced,
 * not merely documented.
 */
export const INTERNAL_ONLY_EVALUATION_FIELDS = [
  "providerId",
  "providerDisplayName",
  "providerType",
  "providerVersion",
  "model",
  "promptVersion",
  "rubricVersion",
  "fallbackFrom",
  "userId",
  "sourceType",
  "sourceId",
] as const;
