import { createHash } from "node:crypto";
import type { ContentEnvelope } from "./envelope";

/**
 * Content identity.
 *
 * A package's identity must not depend on a browser filename, on JSON
 * whitespace, or on key order: the same material hashed twice must produce the
 * same value, and a changed answer must produce a different one. Hashing is done
 * on the NORMALIZED envelope (sorted keys, trimmed strings, declared advisory
 * fields dropped), never on the raw request body.
 */

/** Stable key order + trimmed strings + no advisory/identity fields. */
export function normalizeForHash(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((entry) => normalizeForHash(entry));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, normalizeForHash(entry)]));
  }
  return value;
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalizeForHash(value))).digest("hex");
}

/** The hash that identifies the EDUCATIONAL payload (never the transport metadata). */
export function packageContentHash(envelope: Pick<ContentEnvelope, "module" | "contentType" | "content">): string {
  return canonicalHash({
    module: envelope.module,
    contentType: envelope.contentType,
    content: envelope.content,
  });
}

/** Hash of a binary asset, when the caller supplies one for verification. */
export function assetHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Source identity is compared case-insensitively and without surrounding space;
 * `Listening-Test-11` and `listening-test-11` are the same material.
 */
export function normalizeSourceRef(sourceRef: string): string {
  return sourceRef.trim().toLowerCase();
}
