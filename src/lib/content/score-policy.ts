/**
 * Score policy — the ONE place a raw score becomes a band.
 *
 * Master Prompt 2 §21/§22: Listening and Reading raw scores convert through an
 * explicit, versioned table; Writing and Speaking are criterion-level evaluations
 * that aggregate by policy; a full mock keeps every section score independently
 * inspectable and only computes an overall band by an explicit rule.
 *
 * The tables here are the public IELTS conversion bands, expressed as *ranges*
 * so a boundary is a data point, not an off-by-one accident. Every result that
 * has a band stores the policy version that produced it, so a later policy change
 * never rewrites history: `bandFor(policy, ...)` is pure and the caller persists
 * the version it used.
 *
 * Nothing here scores a learner by itself — no database, no React, no network.
 */

export type ScorePolicyId = "listening" | "reading_academic" | "reading_general_training";

export type ScorePolicy = {
  id: ScorePolicyId;
  /** Version of this table. Bump when a band boundary changes. */
  version: string;
  label: string;
  /** Inclusive raw-score ranges, highest band first. `correct` is out of `total`. */
  bands: { band: number; min: number; max: number }[];
  total: number;
};

/**
 * `v1` — the conversion this product published. Boundaries are inclusive on both
 * ends, so every raw score from 0 to `total` maps to exactly one band.
 */
export const SCORE_POLICIES: Record<ScorePolicyId, ScorePolicy> = {
  listening: {
    id: "listening",
    version: "v1",
    label: "Listening (40 questions)",
    total: 40,
    bands: [
      { band: 9, min: 39, max: 40 },
      { band: 8.5, min: 37, max: 38 },
      { band: 8, min: 35, max: 36 },
      { band: 7.5, min: 32, max: 34 },
      { band: 7, min: 30, max: 31 },
      { band: 6.5, min: 26, max: 29 },
      { band: 6, min: 23, max: 25 },
      { band: 5.5, min: 18, max: 22 },
      { band: 5, min: 16, max: 17 },
      { band: 4.5, min: 13, max: 15 },
      { band: 4, min: 10, max: 12 },
      { band: 3.5, min: 8, max: 9 },
      { band: 3, min: 6, max: 7 },
      { band: 2.5, min: 4, max: 5 },
      { band: 2, min: 3, max: 3 },
      { band: 1.5, min: 2, max: 2 },
      { band: 1, min: 1, max: 1 },
      { band: 0, min: 0, max: 0 },
    ],
  },
  reading_academic: {
    id: "reading_academic",
    version: "v1",
    label: "Academic Reading (40 questions)",
    total: 40,
    bands: [
      { band: 9, min: 39, max: 40 },
      { band: 8.5, min: 37, max: 38 },
      { band: 8, min: 35, max: 36 },
      { band: 7.5, min: 33, max: 34 },
      { band: 7, min: 30, max: 32 },
      { band: 6.5, min: 27, max: 29 },
      { band: 6, min: 23, max: 26 },
      { band: 5.5, min: 19, max: 22 },
      { band: 5, min: 15, max: 18 },
      { band: 4.5, min: 13, max: 14 },
      { band: 4, min: 10, max: 12 },
      { band: 3.5, min: 8, max: 9 },
      { band: 3, min: 6, max: 7 },
      { band: 2.5, min: 4, max: 5 },
      { band: 2, min: 3, max: 3 },
      { band: 1.5, min: 2, max: 2 },
      { band: 1, min: 1, max: 1 },
      { band: 0, min: 0, max: 0 },
    ],
  },
  reading_general_training: {
    id: "reading_general_training",
    version: "v1",
    label: "General Training Reading (40 questions)",
    total: 40,
    bands: [
      { band: 9, min: 40, max: 40 },
      { band: 8.5, min: 39, max: 39 },
      { band: 8, min: 37, max: 38 },
      { band: 7.5, min: 36, max: 36 },
      { band: 7, min: 34, max: 35 },
      { band: 6.5, min: 32, max: 33 },
      { band: 6, min: 30, max: 31 },
      { band: 5.5, min: 27, max: 29 },
      { band: 5, min: 23, max: 26 },
      { band: 4.5, min: 19, max: 22 },
      { band: 4, min: 15, max: 18 },
      { band: 3.5, min: 12, max: 14 },
      { band: 3, min: 9, max: 11 },
      { band: 2.5, min: 6, max: 8 },
      { band: 2, min: 4, max: 5 },
      { band: 1.5, min: 2, max: 3 },
      { band: 1, min: 1, max: 1 },
      { band: 0, min: 0, max: 0 },
    ],
  },
};

export const SCORE_POLICY_VERSIONS: Record<ScorePolicyId, string> = {
  listening: SCORE_POLICIES.listening.version,
  reading_academic: SCORE_POLICIES.reading_academic.version,
  reading_general_training: SCORE_POLICIES.reading_general_training.version,
};

export function scorePolicy(id: ScorePolicyId): ScorePolicy {
  return SCORE_POLICIES[id];
}

export function readingPolicyFor(track: string | null | undefined): ScorePolicy {
  return track === "general_training" ? SCORE_POLICIES.reading_general_training : SCORE_POLICIES.reading_academic;
}

/**
 * Convert a raw score. A raw score outside `0..total` is REFUSED rather than
 * clamped: a result built on a bad count is a bug, and inventing a band for it
 * would hide the bug behind a plausible number.
 */
export function bandFor(
  policy: ScorePolicy,
  raw: number,
  options: { total?: number } = {},
): { band: number; policyId: ScorePolicyId; policyVersion: string } | null {
  const total = options.total ?? policy.total;
  if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) return null;
  if (total !== policy.total || raw > total) return null;
  const row = policy.bands.find((entry) => raw >= entry.min && raw <= entry.max);
  if (!row) return null;
  return { band: row.band, policyId: policy.id, policyVersion: policy.version };
}

/** Band for a count out of a different question total, scaled to the policy's own. */
export function bandForScaled(
  policy: ScorePolicy,
  raw: number,
  total: number,
): { band: number; policyId: ScorePolicyId; policyVersion: string } | null {
  if (!Number.isInteger(total) || total <= 0) return null;
  if (raw < 0 || raw > total) return null;
  const scaled = Math.round((raw / total) * policy.total);
  return bandFor(policy, scaled);
}

/**
 * Writing / Speaking evaluation → criterion bands → one band, by an explicit rule:
 * the mean of the criteria, rounded to the nearest half band (IELTS halves; .25
 * rounds up, .75 rounds up). Never a fabricated number when a criterion is missing.
 */
export function overallBandFromCriteria(bands: (number | null | undefined)[]): number | null {
  const present = bands.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!present.length || present.length !== bands.length) return null;
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length;
  return roundToHalfBand(mean);
}

export function roundToHalfBand(value: number): number {
  const clamped = Math.min(9, Math.max(0, value));
  return Math.round(clamped * 2) / 2;
}

/**
 * Full mock overall band: the mean of SECTION bands (each band weighing the same,
 * as IELTS does), and only when every required section has a band. Section bands
 * themselves stay visible — this function never hides a component behind a number.
 */
export function overallMockBand(sections: { skill: string; band: number | null }[]): number | null {
  if (!sections.length) return null;
  if (sections.some((section) => section.band === null || !Number.isFinite(section.band)))
    return null;
  const mean = sections.reduce((sum, section) => sum + (section.band as number), 0) / sections.length;
  return roundToHalfBand(mean);
}

/* -------------------------------------------------------------------------- */
/* Mock timing policy (also versioned, because a mock stores what it used)      */
/* -------------------------------------------------------------------------- */

export type MockTimingPolicy = {
  id: string;
  version: string;
  label: string;
  sections: { skill: string; seconds: number; breakSeconds: number }[];
  /** Server-authoritative: a refresh never restarts the clock (§15). */
  serverAuthoritative: true;
};

export const MOCK_TIMING_POLICIES: Record<string, MockTimingPolicy> = {
  ielts_full_v1: {
    id: "ielts_full_v1",
    version: "v1",
    label: "IELTS full mock (Listening 30, Reading 60, Writing 60)",
    serverAuthoritative: true,
    sections: [
      { skill: "listening", seconds: 30 * 60, breakSeconds: 0 },
      { skill: "reading", seconds: 60 * 60, breakSeconds: 0 },
      { skill: "writing", seconds: 60 * 60, breakSeconds: 0 },
    ],
  },
  sectional_v1: {
    id: "sectional_v1",
    version: "v1",
    label: "Single-skill mock",
    serverAuthoritative: true,
    sections: [{ skill: "*", seconds: 60 * 60, breakSeconds: 0 }],
  },
};

export function mockTimingPolicy(id: string): MockTimingPolicy | null {
  return MOCK_TIMING_POLICIES[id] ?? null;
}

export function sectionSecondsFor(policy: MockTimingPolicy, skill: string): number | null {
  const exact = policy.sections.find((section) => section.skill === skill);
  if (exact) return exact.seconds;
  const wildcard = policy.sections.find((section) => section.skill === "*");
  return wildcard ? wildcard.seconds : null;
}
