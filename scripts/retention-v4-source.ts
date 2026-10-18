import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { validateAuthoredContent, type AuthoredRetentionContent } from "../src/lib/data/retention-bank";
import { RETENTION_LEVELS } from "../src/lib/retention/levels";
import { evaluateRecall } from "../src/lib/retention/evaluator";

export const RETENTION_V4_SOURCE_SHA256 = "771b5627faf2e1e32bb5eabb11488e7f4a26da20f0d6af1f1577749f0a74df5c";
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Stable hashes are insensitive to PostgreSQL jsonb object-key ordering. */
export function canonicalJson(value: unknown): string {
  const ordered = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(ordered);
    if (input && typeof input === "object") return Object.fromEntries(
      Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]),
    );
    return input;
  };
  return JSON.stringify(ordered(value));
}

const itemSchema = z.object({
  sourceId: z.string(), level: z.enum(RETENTION_LEVELS), declaredWordCount: z.number().int(),
  bodyText: z.string(), scoringStructure: z.unknown(),
}).strict();

export type RetentionV4Item = AuthoredRetentionContent & {
  sourceId: string; bodySha256: string; structureSha256: string;
};

/** Read inert owner data; the original file's authoring instructions are never executed. */
export function readRetentionV4Source(root = resolve(process.cwd(), "content/retention-v4")): RetentionV4Item[] {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as {
    schemaVersion: number; sourceSha256: string; sourceItems: number; perLevel: number; files: Record<string, string>;
  };
  if (manifest.schemaVersion !== 1 || manifest.sourceSha256 !== RETENTION_V4_SOURCE_SHA256 ||
      manifest.sourceItems !== 75 || manifest.perLevel !== 15) throw new Error("retention_v4_source_manifest_mismatch");
  const items: RetentionV4Item[] = [];
  for (const level of RETENTION_LEVELS) {
    const filename = `${level}.jsonl`;
    const source = readFileSync(resolve(root, filename), "utf8");
    if (sha256(source) !== manifest.files[filename]) throw new Error(`retention_v4_source_hash_mismatch:${level}`);
    const rows = source.trim().split(/\r?\n/u);
    if (rows.length !== 15) throw new Error(`retention_v4_source_count_mismatch:${level}`);
    for (const [index, line] of rows.entries()) {
      const row = itemSchema.parse(JSON.parse(line));
      if (row.level !== level || row.sourceId !== `${level}-${String(index + 1).padStart(3, "0")}`) {
        throw new Error("retention_v4_source_identity_mismatch");
      }
      const content = validateAuthoredContent({ level: row.level, bodyText: row.bodyText, scoringStructure: row.scoringStructure });
      if (content.wordCount !== row.declaredWordCount || content.bodyText !== row.bodyText ||
          content.scoringStructure.claims.length !== 5 ||
          content.scoringStructure.claims.some(claim => claim.points !== 20 || claim.scope !== "sentence")) {
        throw new Error(`retention_v4_source_contract_mismatch:${row.sourceId}`);
      }
      for (const [answer, expected] of [
        [content.bodyText, 100], [content.scoringStructure.claims.map(c => c.label).join("\n"), 100],
        ["", 0], ["The sun is shining on an unrelated mountain.", 0],
      ] as const) {
        if (evaluateRecall(answer, content.scoringStructure).score !== expected) {
          throw new Error(`retention_v4_calibration_failed:${row.sourceId}`);
        }
      }
      items.push({ ...content, sourceId: row.sourceId, bodySha256: sha256(content.bodyText),
        structureSha256: sha256(canonicalJson(content.scoringStructure)) });
    }
  }
  if (new Set(items.map(item => item.bodyText)).size !== 75) throw new Error("retention_v4_duplicate_body");
  return items;
}
