import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions } from "@/db/schema";
import { contentHashOf, semanticHashOf, answerKeyHashOf, type VersionReader } from "@/lib/content/versions";
import { contentTypeKey } from "@/lib/content/taxonomy";
import { normalizeSourceRef as coreNormalizeSourceRef } from "@/lib/import/core/identity";

/**
 * SOURCE IDENTITY and DUPLICATE DETECTION (§43).
 *
 * The same material can arrive twice — imported from a package, typed in by hand,
 * converted from a legacy row — and the system has to notice BEFORE a second copy
 * of the same test exists. Three questions are answered here, in one place:
 *
 *   1. What is this content's single stable identity? (`sourceRefFor`, `normalizeSourceRef`)
 *      The IMLED import ledger answers "have we imported this ref before?"
 *      (`peekSourceStatus`); this module answers the harder question — what is the
 *      content's identity across AUTHORING and IMPORT, and does the same material
 *      already exist under a DIFFERENT name?
 *      A source ref is derived from something that does not change (a package's own
 *      source id, a provider's video id, an ISBN-free internal code) — never from a
 *      title, which is allowed to be edited.
 *   2. Is this EXACTLY what we already have? (`classifyIncoming`)
 *      Same source ref + same content hash = the same revision; re-importing it is a
 *      no-op rather than a new version.
 *   3. Is this the same material under a DIFFERENT ref? (`duplicateCandidates`)
 *      Different ref, identical content hash (or identical assessment semantics) is
 *      a probable duplicate and is reported for staff review — never merged
 *      automatically, because only a human knows which ref should win.
 */

/**
 * The shape a source ref may take — the SAME rule the import envelope enforces
 * (`src/lib/import/core/envelope.ts`), so a ref that arrives in a package, a ref an
 * author types and a ref a migration derives are all checked by one rule instead
 * of three that drift apart.
 */
const SOURCE_REF = /^[a-z0-9][a-z0-9._-]{0,79}$/;

/**
 * Canonical form of a source ref: trim and lower-case exactly as the import core
 * decided (`Listening-Test-11` and `listening-test-11` are the same material), then
 * squeeze anything outside the ref charset that the envelope enforces. Case folding
 * is NOT re-implemented here; the charset is defined once, above.
 */
export function normalizeSourceRef(value: string): string {
  return coreNormalizeSourceRef(value)
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
}

/** Truthful only if normalization is a no-op: a ref must already be stable. */
export function isStableSourceRef(value: string): boolean {
  return normalizeSourceRef(value) === value && SOURCE_REF.test(value);
}

/**
 * Derive a source ref from a natural key (a package's source id, a provider video
 * id, an internal code). Returns null when the input cannot produce a stable,
 * meaningful identity — better to make the author supply one than to invent one
 * from a title.
 */
export function sourceRefFor(naturalKey: string): string | null {
  const ref = normalizeSourceRef(naturalKey);
  if (!ref || !SOURCE_REF.test(ref)) return null;
  // The module/content type are stored on the version row already; repeating them
  // here would make a moved item look like a different one.
  return ref;
}

export type ContentFingerprint = {
  contentHash: string;
  semanticHash: string;
  answerKeyHash: string;
};

/**
 * Fingerprints of the CANONICAL content — the same object a version stores.
 * Content authored from a payload is fingerprinted after the author normalizes it,
 * so pass the canonical form (an importer's canonical output, or a version's
 * snapshot) rather than a raw payload.
 */
export function fingerprintOf(module: string, contentType: string, content: unknown): ContentFingerprint {
  return {
    contentHash: contentHashOf(module, contentType, content),
    semanticHash: semanticHashOf(module, contentType, content),
    answerKeyHash: answerKeyHashOf(content),
  };
}

export type IncomingClassification =
  | { kind: "new"; fingerprint: ContentFingerprint }
  | { kind: "identical"; fingerprint: ContentFingerprint; versionNo: number }
  | { kind: "changed"; fingerprint: ContentFingerprint; versionNo: number; change: "metadata" | "answer_key" | "semantic"; }

/**
 * What a re-import of this content means, told BEFORE writing anything.
 *
 * `identical` means the bytes match the newest revision of that source ref: a
 * re-run of the same import must not create a version, and a script can report
 * "unchanged" honestly.
 */
export async function classifyIncoming(
  input: { module: string; contentType: string; sourceRef: string; content: unknown },
  executor: VersionReader = db,
): Promise<IncomingClassification> {
  const fingerprint = fingerprintOf(input.module, input.contentType, input.content);
  const rows = await executor
    .select({
      versionNo: contentVersions.versionNo,
      contentHash: contentVersions.contentHash,
      semanticHash: contentVersions.semanticHash,
      answerKeyHash: contentVersions.answerKeyHash,
    })
    .from(contentVersions)
    .where(
      and(
        eq(contentVersions.module, input.module),
        eq(contentVersions.contentType, input.contentType),
        eq(contentVersions.sourceRef, input.sourceRef),
      ),
    );
  if (rows.length === 0) return { kind: "new", fingerprint };
  const newest = rows.reduce((best, row) => (row.versionNo > best.versionNo ? row : best), rows[0]!);
  if (newest.contentHash === fingerprint.contentHash) return { kind: "identical", fingerprint, versionNo: newest.versionNo };
  if (newest.semanticHash === fingerprint.semanticHash) return { kind: "changed", fingerprint, versionNo: newest.versionNo, change: "metadata" };
  if (newest.answerKeyHash !== fingerprint.answerKeyHash) return { kind: "changed", fingerprint, versionNo: newest.versionNo, change: "answer_key" };
  return { kind: "changed", fingerprint, versionNo: newest.versionNo, change: "semantic" };
}

export type DuplicateCandidate = {
  module: string;
  contentType: string;
  sourceRef: string;
  versionNo: number;
  status: string;
  /** identical content | same assessment semantics (a different title or note) */
  evidence: "identical_content" | "identical_semantics";
};

/**
 * The same material under a DIFFERENT source ref.
 *
 * Reported, never merged: two source refs can legitimately hold the same text (a
 * practice set and the exam it was cut from), and only staff can decide which one
 * is the canonical item. The check is a query, not a heuristic on titles.
 */
export async function duplicateCandidates(
  input: { module: string; contentType: string; sourceRef: string; content: unknown },
  executor: VersionReader = db,
): Promise<DuplicateCandidate[]> {
  const fingerprint = fingerprintOf(input.module, input.contentType, input.content);
  const rows = await executor
    .select({
      module: contentVersions.module,
      contentType: contentVersions.contentType,
      sourceRef: contentVersions.sourceRef,
      versionNo: contentVersions.versionNo,
      status: contentVersions.status,
      contentHash: contentVersions.contentHash,
      semanticHash: contentVersions.semanticHash,
    })
    .from(contentVersions)
    .where(
      and(
        eq(contentVersions.module, input.module),
        eq(contentVersions.contentType, input.contentType),
        ne(contentVersions.sourceRef, input.sourceRef),
      ),
    );

  const seen = new Map<string, DuplicateCandidate>();
  for (const row of rows) {
    const evidence =
      row.contentHash === fingerprint.contentHash
        ? ("identical_content" as const)
        : row.semanticHash === fingerprint.semanticHash
          ? ("identical_semantics" as const)
          : null;
    if (!evidence) continue;
    const key = `${row.sourceRef}`;
    const existing = seen.get(key);
    // Keep the newest revision of each candidate ref.
    if (!existing || row.versionNo > existing.versionNo)
      seen.set(key, {
        module: row.module,
        contentType: row.contentType,
        sourceRef: row.sourceRef,
        versionNo: row.versionNo,
        status: row.status,
        evidence,
      });
  }
  return [...seen.values()].sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
}

export type IdentityReport = {
  contentKey: string;
  classification: IncomingClassification["kind"];
  change?: "metadata" | "answer_key" | "semantic";
  duplicates: DuplicateCandidate[];
  /** True when writing this content would create a new revision. */
  wouldCreateVersion: boolean;
};

/**
 * The whole answer for one incoming item: does it exist, does it differ, and does
 * it look like something already stored under another name? An import (or a legacy
 * conversion) uses this for its dry run, so nothing is written to find out.
 */
export async function identityReport(
  input: { module: string; contentType: string; sourceRef: string; content: unknown },
  executor: VersionReader = db,
): Promise<IdentityReport> {
  const classification = await classifyIncoming(input, executor);
  const duplicates = await duplicateCandidates(input, executor);
  return {
    contentKey: `${contentTypeKey(input.module, input.contentType)}|${input.sourceRef}`,
    classification: classification.kind,
    ...(classification.kind === "changed" ? { change: classification.change } : {}),
    duplicates,
    wouldCreateVersion: classification.kind !== "identical",
  };
}
