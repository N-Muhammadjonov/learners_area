/**
 * The server-authoritative phase of an attempt.
 *
 * The browser never decides which phase a learner is in. It renders a countdown
 * from two persisted deadlines and asks the server for the truth on every
 * transition; this module is where that truth is computed, from absolute UTC
 * timestamps and nothing else.
 *
 * Boundaries (chosen once, tested at the exact second):
 *
 *   now <  read_ends_at                     → READING
 *   read_ends_at <= now < write_ends_at     → RECALL
 *   write_ends_at <= now                    → over: the attempt must be finalized
 *                                             as `timed_out` if it is not already
 *                                             terminal.
 *
 * A restart, a refresh, a suspended tab or a closed laptop changes nothing: the
 * deadlines are in the database, so the learner who comes back at 3:30 gets the
 * terminal result, not a fresh timer.
 */

import type { RetentionAttemptStatus } from "./types";
import { isTerminalStatus } from "./types";
import { RETENTION_READ_SECONDS, RETENTION_WRITE_SECONDS } from "./levels";

export type RetentionPhase = "reading" | "recall" | "completed" | "timed_out";

export type AttemptTiming = {
  status: RetentionAttemptStatus;
  readEndsAt: Date;
  writeEndsAt: Date;
};

export type PhaseResolution = {
  phase: RetentionPhase;
  /** True when the write deadline has passed and the attempt is not terminal. */
  needsFinalization: boolean;
  /** Milliseconds left in the current phase (0 once it is over). */
  millisecondsRemaining: number;
  /** Milliseconds until the write deadline — what the learner's clock shows. */
  millisecondsUntilWriteEnds: number;
};

export function buildDeadlines(startedAt: Date): {
  readStartedAt: Date;
  readEndsAt: Date;
  writeStartedAt: Date;
  writeEndsAt: Date;
} {
  const readEndsAt = new Date(startedAt.getTime() + RETENTION_READ_SECONDS * 1000);
  const writeEndsAt = new Date(readEndsAt.getTime() + RETENTION_WRITE_SECONDS * 1000);
  return {
    readStartedAt: startedAt,
    readEndsAt,
    writeStartedAt: readEndsAt,
    writeEndsAt,
  };
}

export function resolvePhase(timing: AttemptTiming, now: Date): PhaseResolution {
  const nowMs = now.getTime();
  const readEnds = timing.readEndsAt.getTime();
  const writeEnds = timing.writeEndsAt.getTime();
  const millisecondsUntilWriteEnds = Math.max(0, writeEnds - nowMs);

  if (isTerminalStatus(timing.status)) {
    return {
      phase: timing.status === "completed" ? "completed" : "timed_out",
      needsFinalization: false,
      millisecondsRemaining: 0,
      millisecondsUntilWriteEnds,
    };
  }

  if (nowMs < readEnds) {
    return {
      phase: "reading",
      needsFinalization: false,
      millisecondsRemaining: readEnds - nowMs,
      millisecondsUntilWriteEnds,
    };
  }

  if (nowMs < writeEnds) {
    return {
      phase: "recall",
      needsFinalization: false,
      millisecondsRemaining: writeEnds - nowMs,
      millisecondsUntilWriteEnds,
    };
  }

  return {
    phase: "timed_out",
    needsFinalization: true,
    millisecondsRemaining: 0,
    millisecondsUntilWriteEnds: 0,
  };
}
