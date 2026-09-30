/**
 * Measurement Structure V1 — the canonical, strictly validated scoring contract.
 *
 * The owner authors two things: the Retention text and this structure. The
 * structure is data, never code: no callbacks, no regular expressions, no
 * `eval`, no anything that could execute. Every object is parsed with a strict
 * schema, so an unexpected key (`{"regex": "..."}`, `{"script": "..."}`) is a
 * validation error rather than something the evaluator has to defend against.
 *
 * Two conservation rules make the score explainable:
 *
 *   sum(group.points) === claim.points      for every claim
 *   sum(claim.points) === maxScore === 100  for the whole structure
 *
 * Integer points only: no floating weights, no hidden bonus, no 99 and no 101.
 * The final Retention score is therefore always an integer from 0 to 100 that a
 * learner can reproduce by adding up the breakdown.
 */

import { z } from "zod";
import { MEASUREMENT_MAX_SCORE, MEASUREMENT_SCHEMA_VERSION, type MeasurementStructureV1 } from "./types";
import { RetentionError } from "./errors";

export const MEASUREMENT_LIMITS = {
  /** Hard ceiling on the JSON string an admin may paste, before parsing. */
  maxJsonChars: 200_000,
  maxClaims: 40,
  maxGroupsPerClaim: 20,
  maxAnyOfPerGroup: 30,
  maxAcceptedPhrases: 20,
  maxRejectPhrases: 20,
  maxAlternativeChars: 80,
  maxPhraseChars: 200,
  maxLabelChars: 300,
  maxIdChars: 60,
} as const;

const idSchema = z
  .string()
  .trim()
  .min(1, "id_required")
  .max(MEASUREMENT_LIMITS.maxIdChars, "id_too_long")
  .regex(/^[A-Za-z0-9_-]+$/, "id_charset");

const alternativeSchema = z
  .string()
  .trim()
  .min(1, "anyof_empty_alternative")
  .max(MEASUREMENT_LIMITS.maxAlternativeChars, "anyof_alternative_too_long");

export const measurementGroupSchema = z
  .object({
    id: idSchema,
    points: z.number().int("group_points_integer").positive("group_points_positive").max(MEASUREMENT_MAX_SCORE),
    kind: z.enum(["concept", "entity", "number", "date"], {
      errorMap: () => ({ message: "group_kind_unsupported" }),
    }),
    anyOf: z
      .array(alternativeSchema)
      .min(1, "anyof_empty")
      .max(MEASUREMENT_LIMITS.maxAnyOfPerGroup, "anyof_too_many"),
    critical: z.boolean().optional(),
  })
  .strict("group_unexpected_field");

export const measurementClaimSchema = z
  .object({
    id: idSchema,
    label: z.string().trim().min(3, "claim_label_too_short").max(MEASUREMENT_LIMITS.maxLabelChars, "claim_label_too_long"),
    points: z.number().int("claim_points_integer").positive("claim_points_positive").max(MEASUREMENT_MAX_SCORE),
    scope: z.enum(["sentence", "answer"], { errorMap: () => ({ message: "claim_scope_unsupported" }) }),
    groups: z
      .array(measurementGroupSchema)
      .min(1, "claim_groups_empty")
      .max(MEASUREMENT_LIMITS.maxGroupsPerClaim, "claim_groups_too_many"),
    acceptedPhrases: z
      .array(z.string().trim().min(2).max(MEASUREMENT_LIMITS.maxPhraseChars))
      .max(MEASUREMENT_LIMITS.maxAcceptedPhrases, "accepted_phrases_too_many")
      .optional(),
    rejectPhrases: z
      .array(z.string().trim().min(2).max(MEASUREMENT_LIMITS.maxPhraseChars))
      .max(MEASUREMENT_LIMITS.maxRejectPhrases, "reject_phrases_too_many")
      .optional(),
  })
  .strict("claim_unexpected_field");

export const measurementStructureSchema = z
  .object({
    schemaVersion: z.literal(MEASUREMENT_SCHEMA_VERSION, {
      errorMap: () => ({ message: "schema_version_unsupported" }),
    }),
    maxScore: z.literal(MEASUREMENT_MAX_SCORE, { errorMap: () => ({ message: "max_score_not_100" }) }),
    claims: z
      .array(measurementClaimSchema)
      .min(1, "claims_empty")
      .max(MEASUREMENT_LIMITS.maxClaims, "claims_too_many"),
  })
  .strict("root_unexpected_field")
  .superRefine((structure, ctx) => {
    const claimIds = new Set<string>();
    let claimTotal = 0;

    for (const [claimIndex, claim] of structure.claims.entries()) {
      if (claimIds.has(claim.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "claim_id_duplicate", path: ["claims", claimIndex, "id"] });
      }
      claimIds.add(claim.id);

      let groupTotal = 0;
      const groupIds = new Set<string>();
      for (const [groupIndex, group] of claim.groups.entries()) {
        if (groupIds.has(group.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "group_id_duplicate",
            path: ["claims", claimIndex, "groups", groupIndex, "id"],
          });
        }
        groupIds.add(group.id);
        groupTotal += group.points;
      }

      if (groupTotal !== claim.points) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "claim_group_points_mismatch",
          path: ["claims", claimIndex, "points"],
        });
      }

      claimTotal += claim.points;
    }

    if (claimTotal !== structure.maxScore) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "claims_total_not_100", path: ["claims"] });
    }
  });

export type MeasurementValidationIssue = { path: string; code: string };

/**
 * Validate an already-parsed value. Returns the structure with canonical
 * defaults applied (`critical: false`, empty phrase arrays) or throws a
 * `RetentionError` carrying the issue list.
 */
export function validateMeasurementStructure(value: unknown): MeasurementStructureV1 {
  const parsed = measurementStructureSchema.safeParse(value);
  if (!parsed.success) {
    const issues: MeasurementValidationIssue[] = parsed.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.join("."),
      code: issue.message,
    }));
    throw new RetentionError("retention_invalid_structure", "measurement structure rejected", { issues });
  }

  return {
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
    maxScore: MEASUREMENT_MAX_SCORE,
    claims: parsed.data.claims.map((claim) => ({
      id: claim.id,
      label: claim.label,
      points: claim.points,
      scope: claim.scope,
      groups: claim.groups.map((group) => ({
        id: group.id,
        points: group.points,
        kind: group.kind,
        anyOf: group.anyOf,
        critical: group.critical ?? false,
      })),
      acceptedPhrases: claim.acceptedPhrases ?? [],
      rejectPhrases: claim.rejectPhrases ?? [],
    })),
  };
}

/**
 * Strip exactly ONE outer Markdown fence, if and only if the whole input is a
 * fenced block. Deliberately conservative: prose around JSON is not interpreted,
 * and nothing is "figured out" for the author.
 */
export function stripSingleJsonFence(raw: string): string {
  const text = raw.trim();
  const match = /^```[A-Za-z0-9_-]*\s*\n?([\s\S]*?)\n?```$/u.exec(text);
  if (!match) return text;
  return (match[1] ?? "").trim();
}

/** Parse the admin's JSON text field and validate it. Throws `RetentionError`. */
export function parseMeasurementStructureJson(raw: string): MeasurementStructureV1 {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new RetentionError("retention_invalid_structure", "measurement structure empty", {
      issues: [{ path: "", code: "structure_empty" }],
    });
  }
  if (raw.length > MEASUREMENT_LIMITS.maxJsonChars) {
    throw new RetentionError("retention_invalid_structure", "measurement structure too large", {
      issues: [{ path: "", code: "structure_too_large" }],
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripSingleJsonFence(raw));
  } catch {
    throw new RetentionError("retention_invalid_structure", "measurement structure is not valid JSON", {
      issues: [{ path: "", code: "json_syntax" }],
    });
  }

  return validateMeasurementStructure(parsed);
}

/** Total points an author should see; equals 100 for any structure that saves. */
export function totalClaimPoints(structure: MeasurementStructureV1): number {
  return structure.claims.reduce((sum, claim) => sum + claim.points, 0);
}
