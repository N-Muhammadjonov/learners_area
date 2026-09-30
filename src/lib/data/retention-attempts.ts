import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  retentionAttempts,
  retentionRotationCompletions,
  retentionRotationState,
} from "@/db/schema";
import { isRetentionLevel, type RetentionLevel } from "@/lib/retention/levels";
import { RetentionError } from "@/lib/retention/errors";
import { buildDeadlines, resolvePhase, type RetentionPhase } from "@/lib/retention/phase";
import { defaultRandom, selectNextText } from "@/lib/retention/rotation";
import { RETENTION_EVALUATOR_VERSION, isTerminalStatus, type RetentionAttemptStatus, type RetentionBreakdown } from "@/lib/retention/types";
import { evaluateRecall } from "@/lib/retention/evaluator";
import { validateMeasurementStructure } from "@/lib/retention/measurement";
import { listActiveCandidates, loadAssignedVersion, type RetentionBankDatabase } from "@/lib/data/retention-bank";
import { timed } from "@/lib/observability/timing";

/**
 * The learner's Retention attempt, from allocation to durable result.
 *
 * The whole file is built around one sentence from the owner's contract: the
 * SERVER decides. It decides which text the learner gets, when their reading ends,
 * what phase they are in, whether their submission is on time, and what the score
 * is. The browser asks and displays.
 *
 * Three properties are load-bearing and each has a test:
 *
 *   * CONCURRENCY — `startOrResumeAttempt` takes a transaction-scoped advisory
 *     lock per (user, level) and re-reads the live attempt inside it, so two
 *     simultaneous Start requests resolve to the SAME attempt. The partial unique
 *     index from migration 0022 is the backstop if anything ever got past it.
 *   * IDEMPOTENCE — every transition is safe to repeat. A terminal attempt
 *     returns its stored result and is never re-scored, re-timed or re-assigned.
 *   * LAZY FINALIZATION — the write deadline is enforced on access, not by a
 *     browser callback: a learner who closes the tab and returns tomorrow gets
 *     the timed-out result computed from the draft that was already saved.
 */

/** Generous bound for a three-minute writing exercise (§83). */
export const RETENTION_RECALL_MAX_CHARS = 6_000;
const HISTORY_PAGE_SIZE = 10;

export type RetentionAttemptRecord = {
  id: string;
  userId: string;
  retentionTextId: string;
  retentionTextVersionId: string;
  level: RetentionLevel;
  rotationCycle: number;
  status: RetentionAttemptStatus;
  readStartedAt: Date;
  readEndsAt: Date;
  writeStartedAt: Date;
  writeEndsAt: Date;
  recallText: string;
  submittedAt: Date | null;
  completedAt: Date | null;
  score: number | null;
  scoreBreakdown: RetentionBreakdown | null;
  evaluatorVersion: string | null;
};

const ATTEMPT_COLUMNS = {
  id: retentionAttempts.id,
  userId: retentionAttempts.userId,
  retentionTextId: retentionAttempts.retentionTextId,
  retentionTextVersionId: retentionAttempts.retentionTextVersionId,
  level: retentionAttempts.level,
  rotationCycle: retentionAttempts.rotationCycle,
  status: retentionAttempts.status,
  readStartedAt: retentionAttempts.readStartedAt,
  readEndsAt: retentionAttempts.readEndsAt,
  writeStartedAt: retentionAttempts.writeStartedAt,
  writeEndsAt: retentionAttempts.writeEndsAt,
  recallText: retentionAttempts.recallText,
  submittedAt: retentionAttempts.submittedAt,
  completedAt: retentionAttempts.completedAt,
  score: retentionAttempts.score,
  scoreBreakdown: retentionAttempts.scoreBreakdown,
  evaluatorVersion: retentionAttempts.evaluatorVersion,
};

function toRecord(row: unknown): RetentionAttemptRecord {
  const value = row as RetentionAttemptRecord & { scoreBreakdown: RetentionBreakdown | null };
  return { ...value, scoreBreakdown: value.scoreBreakdown ?? null };
}

export type StartAttemptResult = {
  attempt: RetentionAttemptRecord;
  /** `created` = this call allocated the text; `resumed` = an existing attempt. */
  outcome: "created" | "resumed" | "finalized";
  /** True only when the learner was just given a text (internal evidence). */
  assignedTextId?: string;
  assignedVersionId?: string;
};

/**
 * Start or resume. The ONLY learner-controlled input is the level.
 *
 * Nothing else is accepted from the client — not a user id, not a text id, not a
 * version, not a cycle, not a deadline (§127). A learner cannot ask for "B1-007"
 * and cannot re-roll by refreshing: an allocated attempt stays theirs until it
 * completes or its deadline passes (§97).
 */
export async function startOrResumeAttempt(
  input: { userId: string; level: unknown; now?: Date; random?: () => number },
  connection: RetentionBankDatabase = db
): Promise<StartAttemptResult> {
  if (!isRetentionLevel(input.level)) throw new RetentionError("retention_invalid_level", "unsupported level");
  const level = input.level;
  const now = input.now ?? new Date();
  const random = input.random ?? defaultRandom;

  return timed("retention.start", () =>
    connection.transaction(async (tx) => {
      const database = tx as unknown as RetentionBankDatabase;
      // One allocation at a time per learner+level. The lock is transaction
      // scoped, so it is released on commit AND on rollback.
      await database.execute(sql`select pg_advisory_xact_lock(hashtext(${`retention.start:${input.userId}:${level}`}))`);

      const [live] = await database
        .select(ATTEMPT_COLUMNS)
        .from(retentionAttempts)
        .where(
          and(
            eq(retentionAttempts.userId, input.userId),
            eq(retentionAttempts.level, level),
            inArray(retentionAttempts.status, ["reading", "recall"])
          )
        )
        .for("update")
        .limit(1);

      if (live) {
        const record = toRecord(live);
        const phase = resolvePhase(record, now);
        if (phase.needsFinalization) {
          const finalized = await finalizeOn(database, record, now, "timed_out");
          return { attempt: finalized, outcome: "finalized" as const };
        }
        return { attempt: record, outcome: "resumed" as const };
      }

      const candidates = await listActiveCandidates(level, database);
      const rotation = await loadRotationState(database, input.userId, level);

      const decision = selectNextText({
        candidates,
        completedTextIds: rotation.completedTextIds,
        cycleNumber: rotation.cycleNumber,
        lastCompletedTextId: rotation.lastCompletedTextId,
        random,
      });

      if (!decision) throw new RetentionError("retention_no_content", "no active retention text for this level");

      const deadlines = buildDeadlines(now);
      const [created] = await database
        .insert(retentionAttempts)
        .values({
          userId: input.userId,
          retentionTextId: decision.textId,
          retentionTextVersionId: decision.versionId,
          level,
          rotationCycle: decision.cycleNumber,
          status: "reading",
          readStartedAt: deadlines.readStartedAt,
          readEndsAt: deadlines.readEndsAt,
          writeStartedAt: deadlines.writeStartedAt,
          writeEndsAt: deadlines.writeEndsAt,
          recallText: "",
        })
        .returning(ATTEMPT_COLUMNS);

      await ensureRotationRow(database, input.userId, level, decision.cycleNumber);

      return {
        attempt: toRecord(created!),
        outcome: "created" as const,
        assignedTextId: decision.textId,
        assignedVersionId: decision.versionId,
      };
    })
  );
}

async function ensureRotationRow(
  database: RetentionBankDatabase,
  userId: string,
  level: RetentionLevel,
  cycleNumber: number
): Promise<void> {
  await database
    .insert(retentionRotationState)
    .values({ userId, level, cycleNumber, updatedAt: new Date() })
    // The allocation that opens a new cycle must PERSIST it; otherwise later
    // starts keep reading cycle-1 completions and repeat texts early. Runs under
    // the user+level advisory lock; GREATEST keeps the cycle monotonic and
    // leaves lastCompletedTextId untouched.
    .onConflictDoUpdate({
      target: [retentionRotationState.userId, retentionRotationState.level],
      set: {
        cycleNumber: sql`greatest(${retentionRotationState.cycleNumber}, excluded.cycle_number)`,
        updatedAt: new Date(),
      },
    });
}

async function loadRotationState(
  database: RetentionBankDatabase,
  userId: string,
  level: RetentionLevel
): Promise<{ cycleNumber: number; completedTextIds: string[]; lastCompletedTextId: string | null }> {
  const [state] = await database
    .select({
      cycleNumber: retentionRotationState.cycleNumber,
      lastCompletedTextId: retentionRotationState.lastCompletedTextId,
    })
    .from(retentionRotationState)
    .where(and(eq(retentionRotationState.userId, userId), eq(retentionRotationState.level, level)))
    .limit(1);

  const cycleNumber = state?.cycleNumber ?? 1;
  const completions = await database
    .select({ textId: retentionRotationCompletions.retentionTextId })
    .from(retentionRotationCompletions)
    .where(
      and(
        eq(retentionRotationCompletions.userId, userId),
        eq(retentionRotationCompletions.level, level),
        eq(retentionRotationCompletions.cycleNumber, cycleNumber)
      )
    );

  return {
    cycleNumber,
    completedTextIds: completions.map((row) => row.textId),
    lastCompletedTextId: state?.lastCompletedTextId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findAttemptForUser(
  input: { attemptId: string; userId: string; now?: Date },
  connection: RetentionBankDatabase = db
): Promise<RetentionAttemptRecord> {
  const [row] = await connection
    .select(ATTEMPT_COLUMNS)
    .from(retentionAttempts)
    .where(and(eq(retentionAttempts.id, input.attemptId), eq(retentionAttempts.userId, input.userId)))
    .limit(1);
  if (!row) throw new RetentionError("retention_attempt_not_found", "attempt not found");

  const record = toRecord(row);
  const now = input.now ?? new Date();
  const phase = resolvePhase(record, now);
  // Reading a spent attempt finalizes it exactly once, then returns the durable
  // result on every later read (§126, §131).
  if (phase.needsFinalization) {
    return connection.transaction(async (tx) =>
      finalizeOn(tx as unknown as RetentionBankDatabase, record, now, "timed_out")
    );
  }
  return record;
}

export async function findLiveAttempt(
  input: { userId: string; level: unknown; now?: Date },
  connection: RetentionBankDatabase = db
): Promise<RetentionAttemptRecord | null> {
  if (!isRetentionLevel(input.level)) throw new RetentionError("retention_invalid_level", "unsupported level");
  const now = input.now ?? new Date();
  const [row] = await connection
    .select(ATTEMPT_COLUMNS)
    .from(retentionAttempts)
    .where(
      and(
        eq(retentionAttempts.userId, input.userId),
        eq(retentionAttempts.level, input.level),
        inArray(retentionAttempts.status, ["reading", "recall"])
      )
    )
    .limit(1);
  if (!row) return null;
  const record = toRecord(row);
  if (resolvePhase(record, now).needsFinalization) {
    return connection.transaction(async (tx) =>
      finalizeOn(tx as unknown as RetentionBankDatabase, record, now, "timed_out")
    );
  }
  return record;
}

/**
 * The learner's live attempt at ANY level, if there is one.
 *
 * This is what makes "abandoned attempts resume" true on the way back in: the
 * Retention page asks this question first, so a learner who closed the tab during
 * recall lands back on their own countdown instead of being quietly given a new
 * text. The row is still finalized lazily if its deadline has passed.
 */
export async function findAnyLiveAttempt(
  input: { userId: string; now?: Date },
  connection: RetentionBankDatabase = db
): Promise<RetentionAttemptRecord | null> {
  const now = input.now ?? new Date();
  const [row] = await connection
    .select(ATTEMPT_COLUMNS)
    .from(retentionAttempts)
    .where(and(eq(retentionAttempts.userId, input.userId), inArray(retentionAttempts.status, ["reading", "recall"])))
    .orderBy(desc(retentionAttempts.createdAt))
    .limit(1);
  if (!row) return null;
  const record = toRecord(row);
  if (resolvePhase(record, now).needsFinalization) {
    return connection.transaction(async (tx) =>
      finalizeOn(tx as unknown as RetentionBankDatabase, record, now, "timed_out")
    );
  }
  return record;
}

/** The source body, only for the reading phase of an owned attempt. */
export async function loadReadingBody(
  attempt: RetentionAttemptRecord,
  connection: RetentionBankDatabase = db
): Promise<{ bodyText: string; wordCount: number }> {
  const version = await loadAssignedVersion(attempt.retentionTextVersionId, connection);
  if (!version) throw new RetentionError("retention_attempt_not_found", "assigned version is missing");
  return { bodyText: version.bodyText, wordCount: version.wordCount };
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

export async function saveRecallDraft(
  input: { attemptId: string; userId: string; recallText: unknown; now?: Date },
  connection: RetentionBankDatabase = db
): Promise<{ savedAt: string; characterCount: number }> {
  const now = input.now ?? new Date();
  const recallText: unknown = input.recallText;
  if (typeof recallText !== "string") throw new RetentionError("retention_invalid_input", "draft must be text");
  if (recallText.length > RETENTION_RECALL_MAX_CHARS) {
    throw new RetentionError("retention_invalid_input", "draft too long");
  }

  return connection.transaction(async (tx) => {
    const database = tx as unknown as RetentionBankDatabase;
    const [row] = await database
      .select(ATTEMPT_COLUMNS)
      .from(retentionAttempts)
      .where(and(eq(retentionAttempts.id, input.attemptId), eq(retentionAttempts.userId, input.userId)))
      .for("update")
      .limit(1);
    if (!row) throw new RetentionError("retention_attempt_not_found", "attempt not found");

    const record = toRecord(row);
    if (isTerminalStatus(record.status)) {
      // A late autosave for a finished attempt is refused, not applied.
      throw new RetentionError("retention_expired", "attempt is already finished");
    }
    const phase = resolvePhase(record, now);
    if (phase.phase !== "recall") {
      throw new RetentionError("retention_wrong_phase", "draft can only be saved during recall");
    }

    await database
      .update(retentionAttempts)
      .set({ recallText, updatedAt: now })
      .where(eq(retentionAttempts.id, record.id));

    return { savedAt: now.toISOString(), characterCount: recallText.length };
  });
}

// ---------------------------------------------------------------------------
// Submit and timeout finalization
// ---------------------------------------------------------------------------

/**
 * Score the persisted draft against the EXACT assigned version.
 *
 * The assigned version is read by id — never "the current version of this text".
 * An owner edit while a learner is reading cannot change the rubric that learner
 * is graded against (§132).
 */
async function scoreAttempt(
  database: RetentionBankDatabase,
  record: RetentionAttemptRecord
): Promise<{ score: number; breakdown: RetentionBreakdown }> {
  const version = await loadAssignedVersion(record.retentionTextVersionId, database);
  if (!version) throw new RetentionError("retention_scoring_failed", "assigned version is missing");
  let structure;
  try {
    structure = validateMeasurementStructure(version.scoringStructure);
  } catch {
    throw new RetentionError("retention_scoring_failed", "assigned structure failed validation");
  }
  const evaluation = evaluateRecall(record.recallText ?? "", structure);
  return evaluation;
}

async function finalizeOn(
  database: RetentionBankDatabase,
  record: RetentionAttemptRecord,
  now: Date,
  status: "completed" | "timed_out"
): Promise<RetentionAttemptRecord> {
  if (isTerminalStatus(record.status)) return record;

  const { score, breakdown } = await scoreAttempt(database, record);
  const [updated] = await database
    .update(retentionAttempts)
    .set({
      status,
      score,
      scoreBreakdown: breakdown,
      evaluatorVersion: RETENTION_EVALUATOR_VERSION,
      submittedAt: record.submittedAt ?? now,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(retentionAttempts.id, record.id), inArray(retentionAttempts.status, ["reading", "recall"])))
    .returning(ATTEMPT_COLUMNS);

  // A concurrent finalization already won: return the durable row untouched.
  if (!updated) {
    const [existing] = await database
      .select(ATTEMPT_COLUMNS)
      .from(retentionAttempts)
      .where(eq(retentionAttempts.id, record.id))
      .limit(1);
    if (!existing) throw new RetentionError("retention_attempt_not_found", "attempt vanished while finalizing");
    return toRecord(existing);
  }

  const finalized = toRecord(updated);
  // Rotation consumes the logical text: a timed-out attempt has been used, and a
  // low score never brings the same text straight back (§98, §99).
  await database
    .insert(retentionRotationCompletions)
    .values({
      userId: finalized.userId,
      level: finalized.level,
      cycleNumber: finalized.rotationCycle,
      retentionTextId: finalized.retentionTextId,
      completedAt: now,
    })
    .onConflictDoNothing();
  await database
    .update(retentionRotationState)
    .set({ lastCompletedTextId: finalized.retentionTextId, updatedAt: now })
    .where(
      and(eq(retentionRotationState.userId, finalized.userId), eq(retentionRotationState.level, finalized.level))
    );

  return finalized;
}

export async function submitAttempt(
  input: { attemptId: string; userId: string; recallText?: unknown; now?: Date },
  connection: RetentionBankDatabase = db
): Promise<{ attempt: RetentionAttemptRecord; idempotent: boolean }> {
  const now = input.now ?? new Date();
  if (input.recallText !== undefined && typeof input.recallText !== "string") {
    throw new RetentionError("retention_invalid_input", "recall text must be a string");
  }
  if (typeof input.recallText === "string" && input.recallText.length > RETENTION_RECALL_MAX_CHARS) {
    throw new RetentionError("retention_invalid_input", "recall text too long");
  }

  const outcome = await timed("retention.submit", () =>
    connection.transaction(async (tx): Promise<{ attempt: RetentionAttemptRecord; idempotent: boolean } | { scoringFailure: RetentionError }> => {
      const database = tx as unknown as RetentionBankDatabase;
      const [row] = await database
        .select(ATTEMPT_COLUMNS)
        .from(retentionAttempts)
        .where(and(eq(retentionAttempts.id, input.attemptId), eq(retentionAttempts.userId, input.userId)))
        .for("update")
        .limit(1);
      if (!row) throw new RetentionError("retention_attempt_not_found", "attempt not found");

      const record = toRecord(row);

      // Repeated submission is idempotent: the stored result comes back, and the
      // attempt is not re-scored, re-timed or re-assigned (§43, §123).
      if (isTerminalStatus(record.status)) return { attempt: record, idempotent: true };

      const phase = resolvePhase(record, now);

      if (phase.phase === "reading") {
        throw new RetentionError("retention_wrong_phase", "submission is not accepted during the reading phase");
      }

      if (phase.phase === "timed_out") {
        // Late submission: the deadline stands, and the LATEST PERSISTED DRAFT is
        // what gets scored. A client that kept typing after 3:00 gains nothing.
        const finalized = await finalizeOn(database, record, now, "timed_out");
        return { attempt: finalized, idempotent: false };
      }

      // Inside the recall window the submitted text is the text of record. It is
      // written first, and finalization runs in a SAVEPOINT: if evaluation fails,
      // only the finalization rolls back — the on-time recall is committed, the
      // attempt stays non-terminal (no score 0 is invented, no rotation usage is
      // consumed) and the honest error is raised after commit. A later retry, or
      // the timeout path, grades exactly this persisted draft once.
      const recallText = typeof input.recallText === "string" ? input.recallText : record.recallText;
      if (recallText !== record.recallText) {
        await database
          .update(retentionAttempts)
          .set({ recallText, updatedAt: now })
          .where(eq(retentionAttempts.id, record.id));
      }

      try {
        const finalized = await database.transaction(async (savepoint) =>
          finalizeOn(savepoint as unknown as RetentionBankDatabase, { ...record, recallText }, now, "completed"));
        return { attempt: finalized, idempotent: false };
      } catch (error) {
        if (error instanceof RetentionError && error.code === "retention_scoring_failed") return { scoringFailure: error };
        throw error;
      }
    })
  );
  if ("scoringFailure" in outcome) throw outcome.scoringFailure;
  return outcome;
}

/** Explicit timeout sweep for one attempt; the resume path does this lazily. */
export async function finalizeExpiredAttempt(
  input: { attemptId: string; userId: string; now?: Date },
  connection: RetentionBankDatabase = db
): Promise<RetentionAttemptRecord> {
  const record = await findAttemptForUser(input, connection);
  if (!isTerminalStatus(record.status)) {
    const now = input.now ?? new Date();
    return connection.transaction(async (tx) =>
      finalizeOn(tx as unknown as RetentionBankDatabase, record, now, "timed_out")
    );
  }
  return record;
}

// ---------------------------------------------------------------------------
// History and analytics
// ---------------------------------------------------------------------------

export type RetentionHistoryRow = {
  attemptId: string;
  level: RetentionLevel;
  label: string;
  status: RetentionAttemptStatus;
  score: number | null;
  recallWordCount: number;
  completedAt: string | null;
  createdAt: string;
  rotationCycle: number;
};

export async function listRetentionHistory(
  input: { userId: string; page?: number; pageSize?: number },
  connection: RetentionBankDatabase = db
): Promise<{ rows: RetentionHistoryRow[]; page: number; pageSize: number; total: number; pageCount: number }> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(Math.max(1, Math.floor(input.pageSize ?? HISTORY_PAGE_SIZE)), 50);

  // Bounded and owner-scoped: only this learner's terminal attempts, newest first.
  const rows = await connection
    .select({
      attemptId: retentionAttempts.id,
      level: retentionAttempts.level,
      status: retentionAttempts.status,
      score: retentionAttempts.score,
      recallText: retentionAttempts.recallText,
      completedAt: retentionAttempts.completedAt,
      createdAt: retentionAttempts.createdAt,
      rotationCycle: retentionAttempts.rotationCycle,
      label: sql<string>`coalesce((select t.internal_label from retention_texts t where t.id = ${retentionAttempts.retentionTextId}), '')`,
      total: sql<number>`count(*) over ()::int`,
    })
    .from(retentionAttempts)
    .where(and(eq(retentionAttempts.userId, input.userId), inArray(retentionAttempts.status, ["completed", "timed_out"])))
    .orderBy(desc(retentionAttempts.createdAt), desc(retentionAttempts.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map((row) => ({
      attemptId: row.attemptId,
      level: row.level,
      label: row.label,
      status: row.status,
      score: row.score,
      recallWordCount: (row.recallText ?? "").trim().split(/\s+/u).filter(Boolean).length,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      rotationCycle: row.rotationCycle,
    })),
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** One attempt's own history row — used by the result screen after a refresh. */
export async function getRetentionHistoryRow(
  input: { attemptId: string; userId: string },
  connection: RetentionBankDatabase = db
): Promise<RetentionHistoryRow | null> {
  const record = await findAttemptForUser(input, connection);
  if (!isTerminalStatus(record.status)) return null;
  const [label] = await connection
    .select({ label: sql<string>`coalesce((select t.internal_label from retention_texts t where t.id = ${record.retentionTextId}), '')` })
    .from(retentionAttempts)
    .where(eq(retentionAttempts.id, record.id))
    .limit(1);
  return {
    attemptId: record.id,
    level: record.level,
    label: label?.label ?? "",
    status: record.status,
    score: record.score,
    recallWordCount: (record.recallText ?? "").trim().split(/\s+/u).filter(Boolean).length,
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    createdAt: record.readStartedAt.toISOString(),
    rotationCycle: record.rotationCycle,
  };
}

export type RetentionSummary = {
  completedCount: number;
  bestScore: number | null;
  lastTenAverage: number | null;
  lastTenCount: number;
  perLevel: Array<{ level: RetentionLevel; attempts: number; bestScore: number | null; averageScore: number | null }>;
};

/**
 * "My memory" metrics, computed with the definitions in the contract:
 * completed = terminal, scored attempts; best = MAX(score); average = the mean of
 * the LATEST up to 10 scored attempts, rounded to the nearest integer.
 */
export function summarizeScores(
  rows: Array<{ level: RetentionLevel; score: number | null }>
): RetentionSummary {
  const scored = rows.filter((row): row is { level: RetentionLevel; score: number } => typeof row.score === "number");
  const best = scored.length > 0 ? Math.max(...scored.map((row) => row.score)) : null;
  const lastTen = scored.slice(0, 10);
  const average =
    lastTen.length > 0
      ? Math.round(lastTen.reduce((sum, row) => sum + row.score, 0) / lastTen.length)
      : null;

  const levels: RetentionLevel[] = ["A2", "B1", "B2", "C1", "C2"];
  const perLevel = levels.map((level) => {
    const forLevel = scored.filter((row) => row.level === level);
    return {
      level,
      attempts: forLevel.length,
      bestScore: forLevel.length > 0 ? Math.max(...forLevel.map((row) => row.score)) : null,
      averageScore:
        forLevel.length > 0
          ? Math.round(forLevel.reduce((sum, row) => sum + row.score, 0) / forLevel.length)
          : null,
    };
  });

  return {
    completedCount: scored.length,
    bestScore: best,
    lastTenAverage: average,
    lastTenCount: lastTen.length,
    perLevel,
  };
}

export async function getRetentionSummary(
  userId: string,
  connection: RetentionBankDatabase = db
): Promise<RetentionSummary> {
  // All-time metrics are SQL aggregates over every terminal scored attempt
  // (bounded transfer: five grouped rows), never a newest-N window.
  const scoredTerminal = and(
    eq(retentionAttempts.userId, userId),
    inArray(retentionAttempts.status, ["completed", "timed_out"]),
    isNotNull(retentionAttempts.score)
  );
  const grouped = await connection
    .select({
      level: retentionAttempts.level,
      attempts: sql<number>`count(*)::int`,
      best: sql<number | null>`max(${retentionAttempts.score})::int`,
      average: sql<number | null>`round(avg(${retentionAttempts.score}))::int`,
    })
    .from(retentionAttempts)
    .where(scoredTerminal)
    .groupBy(retentionAttempts.level);
  // The rolling average uses only the latest ten scored attempts.
  const recent = await connection
    .select({ score: retentionAttempts.score })
    .from(retentionAttempts)
    .where(scoredTerminal)
    .orderBy(desc(retentionAttempts.createdAt), desc(retentionAttempts.id))
    .limit(10);

  const levels: RetentionLevel[] = ["A2", "B1", "B2", "C1", "C2"];
  const byLevel = new Map(grouped.map((row) => [row.level, row]));
  const perLevel = levels.map((level) => {
    const row = byLevel.get(level);
    return {
      level,
      attempts: row ? Number(row.attempts) : 0,
      bestScore: row?.best ?? null,
      averageScore: row?.average ?? null,
    };
  });
  const scores = recent.map((row) => row.score).filter((score): score is number => typeof score === "number");
  const bests = perLevel.map((row) => row.bestScore).filter((score): score is number => typeof score === "number");
  return {
    completedCount: perLevel.reduce((sum, row) => sum + row.attempts, 0),
    bestScore: bests.length > 0 ? Math.max(...bests) : null,
    lastTenAverage: scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    lastTenCount: scores.length,
    perLevel,
  };
}

export function phaseOf(record: RetentionAttemptRecord, now: Date): RetentionPhase {
  return resolvePhase(record, now).phase;
}
