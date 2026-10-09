import { createHash } from "node:crypto";

/** A submission-time source identity, never a learner-selected contract/key. */
export function objectiveSourceFingerprint(domain: "reading" | "listening", question: unknown, sourceText: string | null, packagePayload: unknown = null): string {
  // Persisted Drizzle rows and validated package objects have deterministic key
  // order within this adapter. Sort recursively so DB JSON key order is irrelevant.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonical({ domain, question, sourceText, packagePayload }))).digest("hex");
}
