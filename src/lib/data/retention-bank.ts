import "server-only";
import { and, asc, count, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { retentionAttempts, retentionTexts, retentionTextVersions } from "@/db/schema";
import {
  RETENTION_LEVELS,
  RETENTION_TARGET_PER_LEVEL,
  isRetentionLevel,
  isWordCountInRange,
  wordRangeFor,
  type RetentionLevel,
} from "@/lib/retention/levels";
import { countWords } from "@/lib/retention/word-count";
import { parseMeasurementStructureJson, validateMeasurementStructure } from "@/lib/retention/measurement";
import { RetentionError } from "@/lib/retention/errors";
import type { MeasurementStructureV1 } from "@/lib/retention/types";
import { recordAudit } from "@/lib/data/audit";

/**
 * The Retention bank: the owner's side of the memory system.
 *
 * Everything here is versioned content, and the rules are the ones the owner
 * asked for in plain language:
 *
 *   * Change always writes a NEW version. Nothing that a learner's result points
 *     at is ever rewritten.
 *   * Delete is ARCHIVE. It removes the text from future rotation and keeps every
 *     attempt, score and version exactly where they are.
 *   * A save either succeeds completely (version + current pointer) or changes
 *     nothing at all — both live in one transaction.
 *   * Usage counts come from aggregated queries, never from one query per row,
 *     because the owner wants to see "108 uses" and "301 lifetime" on a list of
 *     texts that will grow past 75.
 */

/** The database handle type used across this module, so tests can inject one. */
export type RetentionBankDatabase = typeof db;

/** Bounds for anything an admin can paste (§83, §161). */
export const RETENTION_BODY_MAX_CHARS = 8_000;

export type RetentionTextRow = {
  textId: string;
  internalLabel: string;
  level: RetentionLevel;
  active: boolean;
  sequence: number;
  preview: string;
  wordCount: number;
  versionNumber: number;
  currentVersionId: string;
  currentVersionUses: number;
  lifetimeUses: number;
  updatedAt: string;
};

export type RetentionInventoryRow = {
  level: RetentionLevel;
  activeCount: number;
  archivedCount: number;
  target: number;
  remainingToTarget: number;
  lifetimeUses: number;
};

export type RetentionTextDetail = {
  textId: string;
  internalLabel: string;
  level: RetentionLevel;
  active: boolean;
  currentVersionId: string;
  versionNumber: number;
  bodyText: string;
  wordCount: number;
  scoringStructure: MeasurementStructureV1;
  currentVersionUses: number;
  lifetimeUses: number;
  versionCount: number;
};

// ---------------------------------------------------------------------------
// Authoring validation — the single gate both the editor and the importer use
// ---------------------------------------------------------------------------

export type AuthoredRetentionContent = {
  level: RetentionLevel;
  bodyText: string;
  scoringStructure: MeasurementStructureV1;
  wordCount: number;
};

/**
 * Validate the two fields together (§139).
 *
 * The level and the word count are checked against the level's authored range;
 * the Measurement Structure has already been validated by the caller (the CMS
 * parses the JSON first so it can report a syntax error separately from a
 * structural one). No part of this pretends to check that a text really *is* B2
 * — the level stays the owner's declaration, and the UI says so.
 */
export function validateAuthoredContent(input: {
  level: unknown;
  bodyText: unknown;
  scoringStructure: unknown;
}): AuthoredRetentionContent {
  if (!isRetentionLevel(input.level)) {
    throw new RetentionError("retention_invalid_level", "unsupported level");
  }
  if (typeof input.bodyText !== "string") {
    throw new RetentionError("retention_invalid_input", "body must be text");
  }
  if (input.bodyText.length > RETENTION_BODY_MAX_CHARS) {
    throw new RetentionError("retention_invalid_input", "body too large");
  }
  const bodyText = input.bodyText.trim();
  const wordCount = countWords(bodyText);
  if (!isWordCountInRange(input.level, wordCount)) {
    const range = wordRangeFor(input.level);
    throw new RetentionError("retention_word_count_out_of_range", "word count out of range", {
      level: input.level,
      wordCount,
      min: range.min,
      max: range.max,
    });
  }

  const scoringStructure = validateMeasurementStructure(input.scoringStructure);
  return { level: input.level, bodyText, scoringStructure, wordCount };
}

/** Parse + validate the admin's JSON field in one step. */
export function parseAuthoredJson(raw: unknown): MeasurementStructureV1 {
  if (typeof raw !== "string") throw new RetentionError("retention_invalid_structure", "structure must be text");
  return parseMeasurementStructureJson(raw);
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export async function listRetentionInventory(connection: RetentionBankDatabase = db): Promise<RetentionInventoryRow[]> {
  const textCounts = await connection
    .select({
      level: retentionTexts.level,
      activeCount: sql<number>`count(*) filter (where ${retentionTexts.active})::int`,
      archivedCount: sql<number>`count(*) filter (where not ${retentionTexts.active})::int`,
    })
    .from(retentionTexts)
    .groupBy(retentionTexts.level);

  const usage = await connection
    .select({
      level: retentionTexts.level,
      uses: sql<number>`count(*)::int`,
    })
    .from(retentionAttempts)
    .innerJoin(retentionTexts, eq(retentionTexts.id, retentionAttempts.retentionTextId))
    .where(inArray(retentionAttempts.status, ["completed", "timed_out"]))
    .groupBy(retentionTexts.level);

  return RETENTION_LEVELS.map((level) => {
    const counts = textCounts.find((row) => row.level === level);
    const activeCount = counts?.activeCount ?? 0;
    return {
      level,
      activeCount,
      archivedCount: counts?.archivedCount ?? 0,
      target: RETENTION_TARGET_PER_LEVEL,
      remainingToTarget: Math.max(0, RETENTION_TARGET_PER_LEVEL - activeCount),
      lifetimeUses: usage.find((row) => row.level === level)?.uses ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Level bank
// ---------------------------------------------------------------------------

export type RetentionTextFilter = "all" | "active" | "archived";
const LEVEL_PAGE_SIZE = 50;

/**
 * One level's texts with both usage numbers.
 *
 * Two statements, whatever the bank size: the rows (bounded by page size) and one
 * grouped aggregate over the attempts of that level. No per-row counting (§147).
 */
export async function listRetentionLevelTexts(
  level: RetentionLevel,
  filter: RetentionTextFilter = "active",
  connection: RetentionBankDatabase = db
): Promise<RetentionTextRow[]> {
  const where =
    filter === "all"
      ? eq(retentionTexts.level, level)
      : and(eq(retentionTexts.level, level), eq(retentionTexts.active, filter === "active"));

  const rows = await connection
    .select({
      textId: retentionTexts.id,
      internalLabel: retentionTexts.internalLabel,
      level: retentionTexts.level,
      active: retentionTexts.active,
      sequence: retentionTexts.sequence,
      updatedAt: retentionTexts.updatedAt,
      currentVersionId: retentionTexts.currentVersionId,
      versionNumber: retentionTextVersions.versionNumber,
      wordCount: retentionTextVersions.wordCount,
      bodyText: retentionTextVersions.bodyText,
      versionCount: sql<number>`(select count(*)::int from ${retentionTextVersions} v where v.retention_text_id = ${retentionTexts.id})`,
    })
    .from(retentionTexts)
    .leftJoin(retentionTextVersions, eq(retentionTextVersions.id, retentionTexts.currentVersionId))
    .where(where)
    .orderBy(asc(retentionTexts.sequence))
    .limit(LEVEL_PAGE_SIZE);

  if (rows.length === 0) return [];

  const usage = await connection
    .select({
      textId: retentionAttempts.retentionTextId,
      lifetimeUses: sql<number>`count(*)::int`,
      currentVersionUses: sql<number>`count(*) filter (where ${retentionAttempts.retentionTextVersionId} = ${retentionTexts.currentVersionId})::int`,
    })
    .from(retentionAttempts)
    .innerJoin(retentionTexts, eq(retentionTexts.id, retentionAttempts.retentionTextId))
    .where(
      and(
        eq(retentionTexts.level, level),
        inArray(retentionAttempts.status, ["completed", "timed_out"]),
        inArray(
          retentionAttempts.retentionTextId,
          rows.map((row) => row.textId)
        )
      )
    )
    .groupBy(retentionAttempts.retentionTextId);

  return rows.map((row) => {
    const counts = usage.find((entry) => entry.textId === row.textId);
    return {
      textId: row.textId,
      internalLabel: row.internalLabel,
      level: row.level,
      active: row.active,
      sequence: row.sequence,
      preview: previewOf(row.bodyText ?? ""),
      wordCount: row.wordCount ?? 0,
      versionNumber: row.versionNumber ?? 0,
      currentVersionId: row.currentVersionId ?? "",
      currentVersionUses: counts?.currentVersionUses ?? 0,
      lifetimeUses: counts?.lifetimeUses ?? 0,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

function previewOf(body: string, length = 140): string {
  const collapsed = body.replace(/\s+/gu, " ").trim();
  return collapsed.length <= length ? collapsed : `${collapsed.slice(0, length - 1)}…`;
}

export async function getRetentionTextDetail(
  textId: string,
  connection: RetentionBankDatabase = db
): Promise<RetentionTextDetail | null> {
  const [row] = await connection
    .select({
      textId: retentionTexts.id,
      internalLabel: retentionTexts.internalLabel,
      level: retentionTexts.level,
      active: retentionTexts.active,
      currentVersionId: retentionTexts.currentVersionId,
      versionNumber: retentionTextVersions.versionNumber,
      bodyText: retentionTextVersions.bodyText,
      wordCount: retentionTextVersions.wordCount,
      scoringStructure: retentionTextVersions.scoringStructure,
      versionCount: sql<number>`(select count(*)::int from ${retentionTextVersions} v where v.retention_text_id = ${retentionTexts.id})`,
      lifetimeUses: sql<number>`(select count(*)::int from ${retentionAttempts} a where a.retention_text_id = ${retentionTexts.id} and a.status in ('completed','timed_out'))`,
      currentVersionUses: sql<number>`(select count(*)::int from ${retentionAttempts} a where a.retention_text_id = ${retentionTexts.id} and a.retention_text_version_id = ${retentionTexts.currentVersionId} and a.status in ('completed','timed_out'))`,
    })
    .from(retentionTexts)
    .leftJoin(retentionTextVersions, eq(retentionTextVersions.id, retentionTexts.currentVersionId))
    .where(eq(retentionTexts.id, textId))
    .limit(1);

  if (!row) return null;

  // A row edited outside the application is reported as an invalid structure
  // rather than crashing the editor (§164).
  let scoringStructure: MeasurementStructureV1;
  try {
    scoringStructure = validateMeasurementStructure(row.scoringStructure);
  } catch {
    throw new RetentionError("retention_invalid_structure", "stored structure is invalid", {
      textId: row.textId,
    });
  }

  return {
    textId: row.textId,
    internalLabel: row.internalLabel,
    level: row.level,
    active: row.active,
    currentVersionId: row.currentVersionId ?? "",
    versionNumber: row.versionNumber ?? 0,
    bodyText: row.bodyText ?? "",
    wordCount: row.wordCount ?? 0,
    scoringStructure,
    currentVersionUses: row.currentVersionUses ?? 0,
    lifetimeUses: row.lifetimeUses ?? 0,
    versionCount: row.versionCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Per-level label allocation: an advisory lock, not "rows + 1". */
async function nextSequence(tx: RetentionBankDatabase, level: RetentionLevel): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`retention.label:${level}`}))`);
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${retentionTexts.sequence}), 0)::int` })
    .from(retentionTexts)
    .where(eq(retentionTexts.level, level));
  return (row?.max ?? 0) + 1;
}

export function labelFor(level: RetentionLevel, sequence: number): string {
  return `${level}-${String(sequence).padStart(3, "0")}`;
}

export async function createRetentionText(
  input: {
    level: unknown;
    bodyText: unknown;
    scoringStructure: unknown;
    actorUserId: string | null;
  },
  connection: RetentionBankDatabase = db
): Promise<{ textId: string; versionId: string; internalLabel: string; wordCount: number }> {
  const content = validateAuthoredContent(input);

  return connection.transaction(async (tx) => {
    const sequence = await nextSequence(tx as unknown as RetentionBankDatabase, content.level);
    const internalLabel = labelFor(content.level, sequence);

    const [text] = await tx
      .insert(retentionTexts)
      .values({
        level: content.level,
        internalLabel,
        sequence,
        active: true,
        createdByUserId: input.actorUserId,
      })
      .returning({ id: retentionTexts.id });

    const [version] = await tx
      .insert(retentionTextVersions)
      .values({
        retentionTextId: text!.id,
        versionNumber: 1,
        bodyText: content.bodyText,
        wordCount: content.wordCount,
        scoringStructure: content.scoringStructure,
        createdByUserId: input.actorUserId,
      })
      .returning({ id: retentionTextVersions.id });

    await tx
      .update(retentionTexts)
      .set({ currentVersionId: version!.id, updatedAt: new Date() })
      .where(eq(retentionTexts.id, text!.id));

    await recordAudit(
      {
        actorUserId: input.actorUserId,
        action: "retention_text.created",
        targetType: "retention_text",
        targetId: text!.id,
        metadata: { level: content.level, label: internalLabel, version: 1, wordCount: content.wordCount },
      },
      tx as unknown as typeof db
    );

    return { textId: text!.id, versionId: version!.id, internalLabel, wordCount: content.wordCount };
  });
}

/**
 * Change → a NEW immutable version.
 *
 * `expectedCurrentVersionId` is the optimistic guard (§145): an editor opened
 * before another admin's change is refused with a conflict instead of silently
 * overwriting the newer version. A NULL expectation means "no guard" and is only
 * used by the importer.
 */
export async function createRetentionTextVersion(
  input: {
    textId: string;
    bodyText: unknown;
    scoringStructure: unknown;
    actorUserId: string | null;
    expectedCurrentVersionId?: string | null;
  },
  connection: RetentionBankDatabase = db
): Promise<{ versionId: string; versionNumber: number; wordCount: number; internalLabel: string }> {
  return connection.transaction(async (tx) => {
    const [text] = await tx
      .select({
        id: retentionTexts.id,
        level: retentionTexts.level,
        active: retentionTexts.active,
        currentVersionId: retentionTexts.currentVersionId,
        internalLabel: retentionTexts.internalLabel,
      })
      .from(retentionTexts)
      .where(eq(retentionTexts.id, input.textId))
      .for("update")
      .limit(1);

    if (!text) throw new RetentionError("retention_attempt_not_found", "retention text not found");

    if (
      input.expectedCurrentVersionId !== undefined &&
      input.expectedCurrentVersionId !== null &&
      input.expectedCurrentVersionId !== text.currentVersionId
    ) {
      throw new RetentionError("retention_conflict", "the current version changed while you were editing", {
        currentVersionId: text.currentVersionId,
      });
    }

    const content = validateAuthoredContent({
      level: text.level,
      bodyText: input.bodyText,
      scoringStructure: input.scoringStructure,
    });

    // Serialise version allocation for this text; the unique index on
    // (retention_text_id, version_number) is the final guard.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`retention.version:${text.id}`}))`);
    const [latest] = await tx
      .select({ max: sql<number>`coalesce(max(${retentionTextVersions.versionNumber}), 0)::int` })
      .from(retentionTextVersions)
      .where(eq(retentionTextVersions.retentionTextId, text.id));

    const versionNumber = (latest?.max ?? 0) + 1;

    const [version] = await tx
      .insert(retentionTextVersions)
      .values({
        retentionTextId: text.id,
        versionNumber,
        bodyText: content.bodyText,
        wordCount: content.wordCount,
        scoringStructure: content.scoringStructure,
        createdByUserId: input.actorUserId,
      })
      .returning({ id: retentionTextVersions.id });

    // The current-version pointer moves only after the new version exists, so a
    // failure leaves the previous version current (no half-created state).
    await tx
      .update(retentionTexts)
      .set({ currentVersionId: version!.id, updatedAt: new Date() })
      .where(eq(retentionTexts.id, text.id));

    await recordAudit(
      {
        actorUserId: input.actorUserId,
        action: "retention_text.version_created",
        targetType: "retention_text",
        targetId: text.id,
        metadata: { level: text.level, label: text.internalLabel, version: versionNumber, wordCount: content.wordCount },
      },
      tx as unknown as typeof db
    );

    return { versionId: version!.id, versionNumber, wordCount: content.wordCount, internalLabel: text.internalLabel };
  });
}

export async function setRetentionTextActive(
  input: { textId: string; active: boolean; actorUserId: string | null },
  connection: RetentionBankDatabase = db
): Promise<{ textId: string; active: boolean }> {
  return connection.transaction(async (tx) => {
    const [text] = await tx
      .select({ id: retentionTexts.id, active: retentionTexts.active, level: retentionTexts.level, internalLabel: retentionTexts.internalLabel })
      .from(retentionTexts)
      .where(eq(retentionTexts.id, input.textId))
      .for("update")
      .limit(1);
    if (!text) throw new RetentionError("retention_attempt_not_found", "retention text not found");

    if (text.active === input.active) return { textId: text.id, active: text.active };

    await tx
      .update(retentionTexts)
      .set({ active: input.active, updatedAt: new Date() })
      .where(eq(retentionTexts.id, text.id));

    await recordAudit(
      {
        actorUserId: input.actorUserId,
        action: input.active ? "retention_text.restored" : "retention_text.archived",
        targetType: "retention_text",
        targetId: text.id,
        metadata: { level: text.level, label: text.internalLabel },
      },
      tx as unknown as typeof db
    );

    return { textId: text.id, active: input.active };
  });
}

// ---------------------------------------------------------------------------
// Rotation reads (shared with the learner allocation path)
// ---------------------------------------------------------------------------

export type RetentionCandidateRow = { textId: string; versionId: string };

/** Every ACTIVE text of a level that has a current version, ready to assign. */
export async function listActiveCandidates(
  level: RetentionLevel,
  connection: RetentionBankDatabase = db
): Promise<RetentionCandidateRow[]> {
  const rows = await connection
    .select({ textId: retentionTexts.id, versionId: retentionTexts.currentVersionId })
    .from(retentionTexts)
    .where(and(eq(retentionTexts.level, level), eq(retentionTexts.active, true), isNotNull(retentionTexts.currentVersionId)))
    .orderBy(asc(retentionTexts.sequence))
    .limit(1000);
  return rows.map((row) => ({ textId: row.textId, versionId: row.versionId! }));
}

/** How many active texts each level has — used by the learner landing cards. */
export async function countActiveRetentionTexts(
  connection: RetentionBankDatabase = db
): Promise<Record<RetentionLevel, number>> {
  const rows = await connection
    .select({ level: retentionTexts.level, active: count() })
    .from(retentionTexts)
    .where(eq(retentionTexts.active, true))
    .groupBy(retentionTexts.level);
  const result = { A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 } as Record<RetentionLevel, number>;
  for (const row of rows) result[row.level] = Number(row.active);
  return result;
}

/** Smallest set of columns the result screen needs from the assigned version. */
export async function loadAssignedVersion(
  versionId: string,
  connection: RetentionBankDatabase = db
): Promise<{ versionId: string; textId: string; bodyText: string; wordCount: number; scoringStructure: unknown } | null> {
  const [row] = await connection
    .select({
      versionId: retentionTextVersions.id,
      textId: retentionTextVersions.retentionTextId,
      bodyText: retentionTextVersions.bodyText,
      wordCount: retentionTextVersions.wordCount,
      scoringStructure: retentionTextVersions.scoringStructure,
    })
    .from(retentionTextVersions)
    .where(eq(retentionTextVersions.id, versionId))
    .limit(1);
  return row ?? null;
}

/** The internal label for a text — shown in history as a safe identifier. */
export async function labelsForTexts(
  textIds: string[],
  connection: RetentionBankDatabase = db
): Promise<Map<string, { label: string; level: RetentionLevel }>> {
  if (textIds.length === 0) return new Map();
  const rows = await connection
    .select({ id: retentionTexts.id, internalLabel: retentionTexts.internalLabel, level: retentionTexts.level })
    .from(retentionTexts)
    .where(inArray(retentionTexts.id, textIds));
  return new Map(rows.map((row) => [row.id, { label: row.internalLabel, level: row.level }]));
}

/** Newest texts first, for the "Newest" sort option in Management (§114). */
export async function listRetentionLevelTextsNewest(
  level: RetentionLevel,
  filter: RetentionTextFilter = "active",
  connection: RetentionBankDatabase = db
): Promise<RetentionTextRow[]> {
  const rows = await listRetentionLevelTexts(level, filter, connection);
  return [...rows].sort((a, b) => b.sequence - a.sequence);
}

export function sortRetentionRows(rows: RetentionTextRow[], sort: "label" | "uses" | "newest"): RetentionTextRow[] {
  if (sort === "uses") return [...rows].sort((a, b) => b.lifetimeUses - a.lifetimeUses || a.sequence - b.sequence);
  if (sort === "newest") return [...rows].sort((a, b) => b.sequence - a.sequence);
  return [...rows].sort((a, b) => a.sequence - b.sequence);
}
