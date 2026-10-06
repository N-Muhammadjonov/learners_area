import { and, desc, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { contentVersions, type contentVersionStatusEnum } from "@/db/schema";
import { canonicalHash } from "@/lib/import/core/identity";
import type { PublicationState } from "./taxonomy";

/**
 * Content versioning.
 *
 * A published assessment must not change under a learner's feet (§13), and a
 * formal composition must reference an EXACT revision (§33/§72). This module owns
 * that: it decides when a change earns a new version, writes immutable version
 * rows, and answers "which revision was current on this date?".
 *
 * Two hashes matter, and they mean different things:
 *
 *   contentHash   — the whole canonical payload. Any change moves it. Used for
 *                   duplicate detection and for "unchanged" imports.
 *   semanticHash  — the ASSESSMENT-SEMANTIC part: prompts, options, answer keys,
 *                   question wording, instructions. A change here is what makes
 *                   historical regrading unsafe, so it forces a new version of a
 *                   published item even when the payload merely got re-typed.
 *
 * A metadata-only edit (title, topic, notes, provenance, attribution) keeps the
 * version, because nothing a learner was graded on changed (§42).
 */

export type ContentVersionStatus = (typeof contentVersionStatusEnum.enumValues)[number];

export const CHANGE_KINDS = [
  "created",
  "metadata",
  "semantic",
  "answer_key",
  "composition",
  "converted",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export type VersionRecord = {
  id: string;
  module: string;
  contentType: string;
  sourceRef: string;
  versionNo: number;
  status: ContentVersionStatus;
  title: string;
  track: string;
  contentHash: string;
  semanticHash: string;
  answerKeyHash: string;
  publicationState: string;
  targetType: string | null;
  targetId: string | null;
  /** The canonical content as it was at this revision (0043), when recorded. */
  contentSnapshot?: unknown;
};

/** A version identity is (module, contentType, sourceRef, versionNo) — nothing else. */
export function versionIdentity(input: Pick<VersionRecord, "module" | "contentType" | "sourceRef" | "versionNo">): string {
  return `${input.module}:${input.contentType}:${input.sourceRef}@v${input.versionNo}`;
}

export function parseVersionIdentity(identity: string): { module: string; contentType: string; sourceRef: string; versionNo: number } | null {
  const match = /^([a-z]+):([a-z0-9_]+):(.+)@v(\d+)$/.exec(identity);
  if (!match) return null;
  return { module: match[1]!, contentType: match[2]!, sourceRef: match[3]!, versionNo: Number(match[4]) };
}

/* -------------------------------------------------------------------------- */
/* Semantic extraction                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The fields a learner is graded on, per module. Extraction is defensive: an
 * unknown shape yields the whole content (which is the conservative choice — an
 * unknown change always earns a new version).
 */
function semanticProjection(module: string, contentType: string, content: unknown): unknown {
  const value = (content ?? {}) as Record<string, unknown>;
  const pick = (keys: string[]): Record<string, unknown> =>
    Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));

  if (module === "listening" && contentType === "full_test")
    return pick(["questions", "sections", "audio", "image", "imagePath", "mapDiagram", "keyword1", "keyword2", "collection"]);

  if (module === "reading" && (contentType === "general_set" || contentType === "passage" || contentType === "full_test"))
    return pick(["passages", "questions", "timeLimitMinutes"]);

  if (module === "writing" && (contentType === "task1" || contentType === "task2"))
    return pick(["prompt", "instructions", "taskType", "visual", "wordMinimum", "recommendedMinutes", "dataPoints"]);

  if (module === "speaking")
    return pick(["part", "promptText", "cueCard", "followUps", "prepSeconds", "answerSeconds", "questions"]);

  if (module === "grammar") return pick(["promptText", "options", "correctOption", "targetStructures", "translatePromptUz"]);
  if (module === "vocabulary") return pick(["words", "items", "text"]);
  // TED / Podcast: what the learner actually receives — the media reference, the
  // transcript they read, the notes the centre wrote, and the questions that are
  // graded. Changing the notes changes the material, so it is a new revision.
  if (module === "ted" || module === "media")
    return pick([
      "mediaKind",
      "provider",
      "videoId",
      "durationSeconds",
      "beforeYouWatch",
      "notes",
      "transcript",
      "transcriptText",
      "transcriptLines",
      "questions",
      "vocabulary",
      "timeline",
    ]);

  return value;
}

export function semanticHashOf(module: string, contentType: string, content: unknown): string {
  return canonicalHash({ module, contentType, semester: "assessment-semantics/v1", content: semanticProjection(module, contentType, content) });
}

export function contentHashOf(module: string, contentType: string, content: unknown): string {
  return canonicalHash({ module, contentType, content });
}

/* -------------------------------------------------------------------------- */
/* Change classification                                                      */
/* -------------------------------------------------------------------------- */

export type ChangeClassification = {
  kind: ChangeKind;
  /** Does this change require a NEW version of a published item? */
  requiresNewVersion: boolean;
  reasons: string[];
};

export type VersionSnapshot = {
  semanticHash: string;
  contentHash: string;
  answerKeyHash?: string | null;
  status: ContentVersionStatus;
  /** The payload the version described, when the caller can supply it. */
  content?: unknown;
};

const ANSWER_KEY_PATHS = new Set(["key", "answer", "keys", "correctAnswer", "correctOption", "answers", "accepted", "pair"]);

/**
 * The answer-key projection, hashed. Stored on the version row so an answer-key
 * change is detectable from the version history ALONE — a caller does not have to
 * hand back the previous payload for the system to notice that the truth moved.
 */
export function answerKeyHashOf(content: unknown): string {
  return canonicalHash({
    keys: collectStrings(content, ANSWER_KEY_PATHS).sort(),
  });
}

function collectStrings(value: unknown, keys: Set<string>, depth = 0, limit = 20000): string[] {
  if (depth > 8 || limit <= 0) return [];
  const found: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) found.push(...collectStrings(entry, keys, depth + 1, limit - found.length));
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(key)) found.push(JSON.stringify(entry));
      else found.push(...collectStrings(entry, keys, depth + 1, limit - found.length));
      if (found.length >= limit) break;
    }
  }
  return found;
}

/**
 * Classify an incoming revision deterministically (§42). The rules, in order:
 *
 *  1. identical semantic + content hashes → `metadata` (nothing worth versioning),
 *  2. identical semantic hash, different content → `metadata` (labels/notes only),
 *  3. answer keys changed → `answer_key` — always a new version,
 *  4. anything else semantic changed → `semantic` — a new version,
 *  5. no previous version → `created`.
 *
 * Only a PUBLISHED previous version forces the new row; a draft can keep being
 * refined without a version history that nobody will ever read.
 */
export function classifyChange(input: {
  module: string;
  contentType: string;
  previous?: VersionSnapshot | null;
  content: unknown;
}): ChangeClassification {
  const semanticHash = semanticHashOf(input.module, input.contentType, input.content);
  const contentHash = contentHashOf(input.module, input.contentType, input.content);
  if (!input.previous) return { kind: "created", requiresNewVersion: true, reasons: ["No previous version exists."] };
  if (input.previous.semanticHash === semanticHash && input.previous.contentHash === contentHash)
    return { kind: "metadata", requiresNewVersion: false, reasons: ["The payload is byte-for-byte the same material."] };
  if (input.previous.semanticHash === semanticHash)
    return { kind: "metadata", requiresNewVersion: false, reasons: ["Only labels, notes or provenance changed."] };

  const reasons: string[] = [];
  const answerKeyHash = answerKeyHashOf(input.content);
  const keyMoved = input.previous.answerKeyHash
    ? input.previous.answerKeyHash !== answerKeyHash
    : input.previous.content !== undefined
      ? answerKeyHashOf(input.previous.content) !== answerKeyHash
      : false;
  if (keyMoved) {
    reasons.push("An answer key changed, so historical regrading must stay tied to the previous version.");
    return { kind: "answer_key", requiresNewVersion: true, reasons };
  }
  reasons.push("Assessment-semantic content changed (prompt, question wording or instructions).");
  return { kind: "semantic", requiresNewVersion: true, reasons };
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

export type PinVersionInput = {
  module: string;
  contentType: string;
  sourceRef: string;
  title: string;
  track?: string;
  content: unknown;
  publicationState: PublicationState | string;
  actorUserId: string | null;
  targetType?: string | null;
  targetId?: string | null;
  contentImportId?: string | null;
  provenance?: Record<string, unknown> | null;
  note?: string | null;
  /** Set when the change came from a legacy conversion. */
  kind?: ChangeKind;
};

export type PinVersionResult = {
  version: VersionRecord;
  created: boolean;
  change: ChangeClassification;
};

/**
 * Read helpers take an optional executor so they run against whatever connection
 * the caller owns (the app pool, a transaction, or the in-process test database).
 */
export type VersionReader = Pick<typeof db, "select">;

/** The canonical content a revision recorded, or null when it predates snapshots. */
export async function versionContent(versionId: string, executor: VersionReader = db): Promise<unknown | null> {
  if (!UUID_PATTERN.test(versionId)) return null;
  const rows = await executor.select({ contentSnapshot: contentVersions.contentSnapshot }).from(contentVersions).where(eq(contentVersions.id, versionId)).limit(1);
  return rows[0]?.contentSnapshot ?? null;
}

export async function latestVersion(
  module: string,
  contentType: string,
  sourceRef: string,
  executor: VersionReader = db,
): Promise<(VersionRecord & { content: unknown }) | null> {
  const rows = await executor
    .select()
    .from(contentVersions)
    .where(
      and(
        eq(contentVersions.module, module),
        eq(contentVersions.contentType, contentType),
        eq(contentVersions.sourceRef, sourceRef),
      ),
    )
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  const row = rows[0];
  return row ? ({ ...toRecord(row), content: null } as VersionRecord & { content: unknown }) : null;
}

export async function versionById(id: string, executor: VersionReader = db): Promise<VersionRecord | null> {
  // A forged id must resolve to nothing, not to a database error: every caller
  // treats null as "refuse", so a malformed id has to land there too.
  if (!UUID_PATTERN.test(id)) return null;
  const rows = await executor.select().from(contentVersions).where(eq(contentVersions.id, id)).limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function publishedVersion(
  module: string,
  contentType: string,
  sourceRef: string,
  executor: VersionReader = db,
): Promise<VersionRecord | null> {
  const rows = await executor
    .select()
    .from(contentVersions)
    .where(
      and(
        eq(contentVersions.module, module),
        eq(contentVersions.contentType, contentType),
        eq(contentVersions.sourceRef, sourceRef),
        eq(contentVersions.status, "published"),
      ),
    )
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

function toRecord(row: typeof contentVersions.$inferSelect): VersionRecord {
  return {
    id: row.id,
    module: row.module,
    contentType: row.contentType,
    sourceRef: row.sourceRef,
    versionNo: row.versionNo,
    status: row.status,
    title: row.title,
    track: row.track,
    contentHash: row.contentHash,
    semanticHash: row.semanticHash,
    answerKeyHash: row.answerKeyHash,
    publicationState: row.publicationState,
    targetType: row.targetType,
    targetId: row.targetId,
  };
}

/**
 * Write the version row for an accepted change.
 *
 * Called inside the importer's transaction (never on its own), so a version row
 * and the content it describes either both land or neither does. Superseding is
 * deliberate: the previous published row moves to `superseded` and KEEPS its
 * data, because attempts already bound to it must stay readable.
 */
export async function pinVersion(
  tx: { select: typeof db.select; insert: typeof db.insert; update: typeof db.update },
  input: PinVersionInput,
): Promise<PinVersionResult> {
  const previousRows = await tx
    .select()
    .from(contentVersions)
    .where(
      and(
        eq(contentVersions.module, input.module),
        eq(contentVersions.contentType, input.contentType),
        eq(contentVersions.sourceRef, input.sourceRef),
      ),
    )
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  const previous = previousRows[0] ?? null;

  const change = classifyChange({
    module: input.module,
    contentType: input.contentType,
    previous: previous
      ? {
          semanticHash: previous.semanticHash,
          contentHash: previous.contentHash,
          answerKeyHash: previous.answerKeyHash,
          status: previous.status,
        }
      : null,
    content: input.content,
  });
  const kind: ChangeKind = input.kind ?? change.kind;

  if (previous && !change.requiresNewVersion) {
    // Metadata-only: refresh the descriptive fields on the SAME version.
    const [updated] = await tx
      .update(contentVersions)
      .set({
        title: input.title,
        track: input.track ?? previous.track,
        publicationState: String(input.publicationState),
        ...(input.note !== undefined ? { note: input.note ?? null } : {}),
      })
      .where(eq(contentVersions.id, previous.id))
      .returning();
    return { version: toRecord(updated!), created: false, change };
  }

  const nextNo = (previous?.versionNo ?? 0) + 1;
  const semanticHash = semanticHashOf(input.module, input.contentType, input.content);
  const contentHash = contentHashOf(input.module, input.contentType, input.content);
  const answerKeyHash = answerKeyHashOf(input.content);
  const published = String(input.publicationState) === "published";

  if (previous && previous.status === "published")
    await tx
      .update(contentVersions)
      .set({ status: "superseded", supersededAt: new Date() })
      .where(eq(contentVersions.id, previous.id));

  const [row] = await tx
    .insert(contentVersions)
    .values({
      module: input.module,
      contentType: input.contentType,
      sourceRef: input.sourceRef,
      versionNo: nextNo,
      status: published ? "published" : "draft",
      title: input.title,
      track: input.track ?? "unspecified",
      contentHash,
      semanticHash,
      answerKeyHash,
      contentSnapshot: input.content ?? null,
      publicationState: String(input.publicationState),
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      contentImportId: input.contentImportId ?? null,
      createdByUserId: input.actorUserId,
      changeKind: kind,
      provenance: input.provenance ?? null,
      note: input.note ?? null,
      publishedAt: published ? new Date() : null,
    })
    .returning();

  return { version: toRecord(row!), created: true, change: { ...change, kind } };
}

export type AttemptBinder = {
  select: typeof db.select;
  update: typeof db.update;
};

/** Any attempt table that can record what it was graded against. */
export type VersionBoundTable = PgTable & { id: PgColumn; contentVersionId: PgColumn };

export type BindResult = { ok: true } | { ok: false; reason: "invalid_attempt_id" | "invalid_version_id" | "version_not_found" };

/**
 * Bind an attempt to a version.
 *
 * Refuses rather than half-succeeds: the attempt id and the version id are both
 * checked, and a version that does not exist is rejected instead of written as a
 * dangling reference. A caller that ignores `ok: false` never silently regrades —
 * an unbound attempt simply has no pinned revision.
 */
export async function bindAttempt(
  tx: AttemptBinder,
  table: VersionBoundTable,
  attemptId: string,
  versionId: string | null,
): Promise<BindResult> {
  if (!UUID_PATTERN.test(attemptId)) return { ok: false, reason: "invalid_attempt_id" };
  if (versionId !== null) {
    if (!UUID_PATTERN.test(versionId)) return { ok: false, reason: "invalid_version_id" };
    const rows = await tx.select({ id: contentVersions.id }).from(contentVersions).where(eq(contentVersions.id, versionId)).limit(1);
    if (!rows[0]) return { ok: false, reason: "version_not_found" };
  }
  await tx
    .update(table)
    .set({ contentVersionId: versionId } as Partial<Record<"contentVersionId", string | null>>)
    .where(eq(table.id, attemptId));
  return { ok: true };
}

/**
 * Publication change → version status. Publishing a version marks it `published`
 * and the previous one `superseded`; archiving marks it `archived` and keeps it
 * readable for historical attempts (§41).
 */
export function versionStatusForPublication(state: string): ContentVersionStatus {
  if (state === "published" || state === "scheduled") return "published";
  if (state === "archived") return "archived";
  return "draft";
}

/** Review-facing description of a version, without leaking authoring internals. */
export function versionLabel(version: Pick<VersionRecord, "versionNo" | "status"> & { changeKind?: string }): string {
  return `v${version.versionNo}`;
}
