/**
 * The Retention domain vocabulary.
 *
 * One place for the level, the attempt states, the Measurement Structure and the
 * score breakdown, so no module has to guess at a string or a shape. These are
 * TypeScript types only — every one of them is *also* validated at runtime when
 * it arrives from outside the process (see `measurement.ts`), because a type
 * annotation is not a security check.
 */

import type { RetentionLevel } from "./levels";

// ---------------------------------------------------------------------------
// Attempt lifecycle
// ---------------------------------------------------------------------------

/**
 * The states an attempt can be in.
 *
 * `reading` and `recall` are derived from the persisted deadlines plus the
 * attempt's own terminal state — never from the browser. `completed` means the
 * learner submitted inside the recall window; `timed_out` means the write
 * deadline passed and the latest saved draft was finalized. Both are terminal
 * and both are immutable afterwards.
 */
export const RETENTION_ATTEMPT_STATUSES = ["reading", "recall", "completed", "timed_out"] as const;
export type RetentionAttemptStatus = (typeof RETENTION_ATTEMPT_STATUSES)[number];

export const RETENTION_TERMINAL_STATUSES = ["completed", "timed_out"] as const;
export function isTerminalStatus(status: RetentionAttemptStatus): boolean {
  return status === "completed" || status === "timed_out";
}

/** The evaluator identity persisted on every scored attempt. */
export const RETENTION_EVALUATOR_VERSION = "retention-deterministic-v4";

// ---------------------------------------------------------------------------
// Measurement Structure V1
// ---------------------------------------------------------------------------

export const MEASUREMENT_SCHEMA_VERSION = 1;
export const MEASUREMENT_MAX_SCORE = 100;

export const RETENTION_GROUP_KINDS = ["concept", "entity", "number", "date"] as const;
export type RetentionGroupKind = (typeof RETENTION_GROUP_KINDS)[number];

export const RETENTION_CLAIM_SCOPES = ["sentence", "answer"] as const;
export type RetentionClaimScope = (typeof RETENTION_CLAIM_SCOPES)[number];

export type MeasurementGroup = {
  id: string;
  points: number;
  kind: RetentionGroupKind;
  anyOf: string[];
  critical: boolean;
};

export type MeasurementClaim = {
  id: string;
  label: string;
  points: number;
  scope: RetentionClaimScope;
  groups: MeasurementGroup[];
  acceptedPhrases: string[];
  rejectPhrases: string[];
};

export type MeasurementStructureV1 = {
  schemaVersion: 1;
  maxScore: 100;
  claims: MeasurementClaim[];
};

// ---------------------------------------------------------------------------
// Score breakdown (persisted on the attempt, shown to the learner)
// ---------------------------------------------------------------------------

export const RETENTION_CLAIM_STATUSES = ["captured", "partial", "missed", "contradicted"] as const;
export type RetentionClaimStatus = (typeof RETENTION_CLAIM_STATUSES)[number];

export type RetentionClaimResult = {
  claimId: string;
  claimLabel: string;
  possiblePoints: number;
  awardedPoints: number;
  status: RetentionClaimStatus;
  matchedGroupIds: string[];
  missingGroupIds: string[];
  missingCriticalGroupIds: string[];
};

export type RetentionBreakdown = {
  schemaVersion: 1;
  evaluatorVersion: string;
  maxScore: number;
  score: number;
  totals: {
    captured: number;
    partial: number;
    missed: number;
    contradicted: number;
    matchedGroups: number;
    totalGroups: number;
    mainIdeasRemembered: number;
    mainIdeasPossible: number;
  };
  claims: RetentionClaimResult[];
};

export type RetentionEvaluation = {
  score: number;
  breakdown: RetentionBreakdown;
};

// ---------------------------------------------------------------------------
// Learner-safe attempt payloads (what an API may return)
// ---------------------------------------------------------------------------

export type RetentionAttemptMeta = {
  attemptId: string;
  level: RetentionLevel;
  label: string;
  readStartedAt: string;
  readEndsAt: string;
  writeStartedAt: string;
  writeEndsAt: string;
  /** Server clock at the moment of the response — the client's skew reference. */
  serverNow: string;
};

/** READING may include the source body; RECALL and terminal payloads may not. */
export type RetentionReadingPayload = RetentionAttemptMeta & {
  phase: "reading";
  wordCount: number;
  bodyText: string;
};

export type RetentionRecallPayload = RetentionAttemptMeta & {
  phase: "recall";
  recallDraft: string;
};

export type RetentionTerminalPayload = RetentionAttemptMeta & {
  phase: "completed" | "timed_out";
  score: number;
  breakdown: RetentionBreakdown;
  evaluatorVersion: string;
  recallWordCount: number;
  submittedAt: string | null;
  completedAt: string | null;
};

export type RetentionAttemptPayload =
  | RetentionReadingPayload
  | RetentionRecallPayload
  | RetentionTerminalPayload;
