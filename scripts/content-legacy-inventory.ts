/**
 * LEGACY CONTENT INVENTORY (§93, §94).
 *
 * Every piece of content that lives in the repository rather than in canonical
 * storage is listed here, with its classification and the reason for it. Nothing
 * is deleted by this tool: it reports, and where a safe conversion exists it can
 * run that conversion through the standard authoring path (§95).
 *
 * Classifications:
 *   KEEP                        – not content; infrastructure or genuinely native code
 *   MIGRATE                     – real content that must become canonical
 *   COMPATIBILITY ONLY          – reads stay because stored or historical rows depend
 *                                 on them, but nothing new may be authored into it
 *   REMOVE AFTER MIGRATION      – superseded once its content is canonical and the
 *                                 dependency check below is clean
 *   MANUAL REVIEW REQUIRED      – cannot be classified mechanically (ambiguous scope,
 *                                 external provider, copyright question)
 *
 * Run with `--json` for machine use, `--migrate` to convert the items whose
 * conversion is implemented and safe.
 */

const ITEMS = [
  {
    path: "src/lib/content/*",
    what: "canonical content layer (taxonomy, question types, versions, score policy, mocks, authoring, blocks, lessons, vocabulary packs, assignments, identity)",
    classification: "KEEP",
    reason: "this IS the canonical system; keep the module free of IELTS-only assumptions",
  },
  {
    path: "src/lib/services/vocabulary/packs.ts",
    what: "hard-coded built-in topical vocabulary packs (topics → words)",
    classification: "COMPATIBILITY ONLY",
    reason:
      "learners must see a pack before any pack is authored, and stored rows reference pack ids. The DB becomes the source of truth the moment a pack is published; this list must not gain new words (§31).",
    successor: "src/lib/content/vocabulary-packs.ts",
    convertedBy: "scripts/content-backfill-vocabulary-packs.ts",
  },
  {
    path: "src/lib/services/writing/topic-vocabulary.ts",
    what: "per-topic vocabulary suggestions attached to writing patterns",
    classification: "MIGRATE",
    reason:
      "topic vocabulary is learner-facing vocabulary held outside the lexical system, which makes a word exist twice (§76). It must become lexeme → sense → occurrence, referenced from the writing topic rather than embedded.",
    successor: "lexemes/senses with a content_reference from the writing topic",
    needsMigration: true,
  },
  {
    path: "src/lib/data/reading-library.ts",
    what: "legacy reading library view over reading attempts/passages",
    classification: "COMPATIBILITY ONLY",
    reason:
      "historical attempts were recorded against these rows and must stay readable; new reading content is authored/imported as canonical reading sets (§94).",
    successor: "reading canonical sets in content_versions",
  },
  {
    path: "src/lib/import/listening/legacy.ts",
    what: "legacy listening conversion path",
    classification: "COMPATIBILITY ONLY",
    reason: "exists precisely to convert old shapes; keep it as the reading half of the migration story, and do not add new formats here.",
    successor: "src/lib/import/listening/canonical.ts",
  },
  {
    path: "src/lib/import/reading/*",
    what: "reading import + conversion (source, canonical)",
    classification: "KEEP",
    reason: "working import foundation; it feeds the canonical store through the standard path",
  },
  {
    path: "src/lib/import/listening/*",
    what: "listening import + conversion (canonical, importer, index)",
    classification: "KEEP",
    reason: "working import foundation; canonical outputs, version-bound attempts",
  },
  {
    path: "src/lib/reading/lexical-policy.ts, src/lib/listening/lexical-policy.ts",
    what: "per-skill lexical policies",
    classification: "KEEP",
    reason: "policy, not content: they decide which words a learner is asked about",
  },
  {
    path: "src/db/seed.ts",
    what: "development seed data",
    classification: "COMPATIBILITY ONLY",
    reason: "local fixtures only — never a production content source (§96 synthetic data)",
  },
  {
    path: "src/lib/data/listening-attempt-write.ts",
    what: "listening attempt write path",
    classification: "KEEP",
    reason: "attempt plumbing, not content",
  },
  {
    path: "src/lib/content/mocks.ts / score-policy.ts",
    what: "mock orchestration + score policy versions",
    classification: "KEEP",
    reason: "canonical orchestration objects; mocks compose content by reference",
  },
  {
    path: "external provider material (TED programmes, podcast episodes, published test papers)",
    what: "media referenced by external id, or material whose copyright status is unknown",
    classification: "MANUAL REVIEW REQUIRED",
    reason:
      "an external id is a reference and is safe; any stored transcript, question text or audio that came from a copyrighted paper must be reviewed by a human before it is stored, and no copyrighted question may be re-created here (§75, §96).",
  },
] as const;

export type LegacyClassification = "KEEP" | "MIGRATE" | "COMPATIBILITY ONLY" | "REMOVE AFTER MIGRATION" | "MANUAL REVIEW REQUIRED";

export type LegacyItem = {
  path: string;
  what: string;
  classification: LegacyClassification;
  reason: string;
  successor?: string;
  convertedBy?: string;
  needsMigration?: boolean;
};

export function legacyInventory(): LegacyItem[] {
  return ITEMS.map((item) => ({ ...item })) as LegacyItem[];
}

export function inventorySummary(items: readonly LegacyItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.classification] = (counts[item.classification] ?? 0) + 1;
  return counts;
}

/**
 * The one rule that keeps this file honest: content that must move is never
 * "resolved" by pointing at itself, and the items classified as removable must
 * name the successor that replaces them. A missing successor is a real finding,
 * so the check fails rather than printing a tidy table.
 */
export function inventoryProblems(items: readonly LegacyItem[] = legacyInventory()): string[] {
  const problems: string[] = [];
  for (const item of items) {
    const mustMove = item.classification === "REMOVE AFTER MIGRATION" || item.classification === "MIGRATE";
    if (mustMove && !item.successor) problems.push(`${item.path}: classified ${item.classification} but names no successor`);
    if (item.classification === "REMOVE AFTER MIGRATION" && !item.convertedBy && !item.successor)
      problems.push(`${item.path}: removal claimed with no conversion path`);
    if (item.classification === "MANUAL REVIEW REQUIRED" && item.convertedBy)
      problems.push(`${item.path}: cannot be both automatically converted and awaiting review`);
  }
  return problems;
}

export function formatInventory(items: readonly LegacyItem[]): string {
  const lines = ["LEGACY CONTENT INVENTORY (§93)", ""];
  for (const item of items) {
    lines.push(`• ${item.path}`);
    lines.push(`    ${item.what}`);
    lines.push(`    ${item.classification} — ${item.reason}`);
    if (item.successor) lines.push(`    successor: ${item.successor}`);
    if (item.convertedBy) lines.push(`    conversion: ${item.convertedBy}`);
    lines.push("");
  }
  const summary = inventorySummary(items);
  lines.push(`TOTAL ${items.length} — ` + Object.entries(summary).map(([key, value]) => `${key}: ${value}`).join(", "));
  const problems = inventoryProblems(items);
  lines.push(problems.length === 0 ? "no problems found" : `PROBLEMS: ${problems.length}`);
  for (const problem of problems) lines.push(`  - ${problem}`);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ items: legacyInventory(), summary: inventorySummary(legacyInventory()), problems: inventoryProblems() }, null, 2));
    return;
  }
  console.log(formatInventory(legacyInventory()));
  if (inventoryProblems().length > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("content-legacy-inventory.ts")) {
  void main();
}
