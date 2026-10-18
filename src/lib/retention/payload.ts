import "server-only";
import { countWords } from "@/lib/retention/word-count";
import { RetentionError } from "@/lib/retention/errors";
import { resolvePhase } from "@/lib/retention/phase";
import type {
  RetentionAttemptPayload,
  RetentionBreakdown,
  RetentionRecallPayload,
  RetentionTerminalPayload,
  RetentionReadingPayload,
} from "@/lib/retention/types";
import { labelsForTexts } from "@/lib/data/retention-bank";
import { loadReadingBody, type RetentionAttemptRecord } from "@/lib/data/retention-attempts";
import type { RetentionBankDatabase } from "@/lib/data/retention-bank";

/**
 * The ONE place that decides what a learner's browser may receive.
 *
 * This module exists because source privacy is a property of the SERVER's
 * response, not of a component's `display: none`. The rules it enforces:
 *
 *   READING   the source body is the task — it is returned, and the Measurement
 *             Structure never is.
 *   RECALL    neither the body nor the structure is returned. The learner gets
 *             their own saved draft and the deadline. The body has already left
 *             the payload, so there is nothing in the DOM, in client state, in a
 *             data attribute or in the hydration payload for a toggle to reveal.
 *   TERMINAL  the learner-safe score breakdown only — never `anyOf`, never the
 *             accepted or rejected phrases, never the group alternatives.
 *
 * `assertLearnerSafe` is the guard the leakage tests call on a serialized
 * payload, so the promise is checked by a test rather than by a comment.
 */

/**
 * Keys that must never appear in a learner payload at ANY depth.
 *
 * `claims` is deliberately NOT here: the terminal breakdown legitimately has a
 * `claims` array of learner-safe results. What is forbidden is the authoring
 * shape of a claim — the alternatives, the accepted/rejected phrases, the group
 * list — and the source body once the reading phase is over.
 */
export const FORBIDDEN_PAYLOAD_KEYS = [
  "scoringStructure",
  "scoring_structure",
  "measurementStructure",
  "anyOf",
  "acceptedPhrases",
  "rejectPhrases",
  "groups",
] as const;

function scanForbidden(value: unknown, phase: string, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) scanForbidden(entry, phase, depth + 1);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      throw new Error(`learner payload leaks ${key}`);
    }
    if (key === "bodyText" && phase !== "reading") {
      throw new Error("learner payload leaks the source body outside the reading phase");
    }
    scanForbidden(entry, phase, depth + 1);
  }
}

function metaOf(attempt: RetentionAttemptRecord, label: string) {
  return {
    attemptId: attempt.id,
    level: attempt.level,
    label,
    readStartedAt: attempt.readStartedAt.toISOString(),
    readEndsAt: attempt.readEndsAt.toISOString(),
    writeStartedAt: attempt.writeStartedAt.toISOString(),
    writeEndsAt: attempt.writeEndsAt.toISOString(),
  };
}

export async function buildAttemptPayload(
  attempt: RetentionAttemptRecord,
  now: Date,
  connection: RetentionBankDatabase
): Promise<RetentionAttemptPayload> {
  const labels = await labelsForTexts(attempt.retentionTextId ? [attempt.retentionTextId] : [], connection);
  const label = attempt.retentionLabelSnapshot ?? (attempt.retentionTextId ? labels.get(attempt.retentionTextId)?.label : null) ?? "";
  const meta = metaOf(attempt, label);
  const serverNow = now.toISOString();
  const phase = resolvePhase(attempt, now);

  if (phase.needsFinalization) {
    throw new RetentionError("retention_expired", "attempt must be finalized before it is read");
  }

  if (phase.phase === "reading") {
    const source = await loadReadingBody(attempt, connection);
    const payload: RetentionReadingPayload = {
      ...meta,
      phase: "reading",
      serverNow,
      wordCount: source.wordCount,
      bodyText: source.bodyText,
    };
    return payload;
  }

  if (phase.phase === "recall") {
    const payload: RetentionRecallPayload = {
      ...meta,
      phase: "recall",
      serverNow,
      recallDraft: attempt.recallText ?? "",
    };
    return payload;
  }

  const payload: RetentionTerminalPayload = {
    ...meta,
    phase: phase.phase === "completed" ? "completed" : "timed_out",
    serverNow,
    score: attempt.score ?? 0,
    breakdown: (attempt.scoreBreakdown as RetentionBreakdown) ?? emptyBreakdown(attempt.score ?? 0),
    evaluatorVersion: attempt.evaluatorVersion ?? "",
    recallWordCount: countRecallWords(attempt.recallText ?? ""),
    submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
    completedAt: attempt.completedAt ? attempt.completedAt.toISOString() : null,
  };
  return payload;
}

/** The shared canonical counter, so result, history and editor agree. */
function countRecallWords(text: string): number {
  return countWords(text);
}

function emptyBreakdown(score: number): RetentionBreakdown {
  return {
    schemaVersion: 1,
    evaluatorVersion: "",
    maxScore: 100,
    score,
    totals: {
      captured: 0,
      partial: 0,
      missed: 0,
      contradicted: 0,
      matchedGroups: 0,
      totalGroups: 0,
      mainIdeasRemembered: 0,
      mainIdeasPossible: 0,
    },
    claims: [],
  };
}

/**
 * Test- and route-level guard: a serialized learner payload must not contain the
 * rubric, or the source once the reading phase is over.
 */
export function assertLearnerSafe(payload: RetentionAttemptPayload): void {
  // Structural, not textual: a learner is allowed to TYPE the word "anyOf" into
  // their answer, and that is not a leak. What is a leak is the rubric travelling
  // as data — so the walk looks at keys at every depth, which also covers the
  // breakdown the terminal payload returns.
  scanForbidden(payload, payload.phase);
}
