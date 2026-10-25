/**
 * FINAL V2 private server-side content + approved, source-grounded corrections.
 * Never import this module into learner components or public API payloads:
 * scoring rubrics must remain server-only.
 *
 * The owner's authored JSONL remains untouched. Corrections are explicit
 * allowlisted additions of actual claim labels/source clauses, auditable per ID.
 */
import { readFileSync } from "node:fs";
import { RETENTION_LEVELS } from "../../src/lib/retention/levels";
import { normalizeText } from "../../src/lib/retention/normalize";
import { validateMeasurementStructure } from "../../src/lib/retention/measurement";

export type RetentionV2Content = {
  sourceId: string;
  level: string;
  bodyText: string;
  scoringStructure: ReturnType<typeof validateMeasurementStructure>;
};

type RawItem = {
  sourceId: string;
  level: string;
  bodyText: string;
  scoringStructure: unknown;
};
type Patch = { sourceId: string; claimId: string; addAcceptedPhrases: string[] };

const normalizeFact = (raw: string): string =>
  normalizeText(raw).replace(/[^a-z0-9]+/giu, " ").trim();

function verifiedPatch(phrase: string, item: RawItem, claimLabel: string): boolean {
  if (!phrase || phrase.length < 40 || phrase.length > 220) return false;
  const value = normalizeFact(phrase);
  // A correction must be a verbatim source passage or the exact authored
  // claim label; do not add speculative interpretations or keyword shortcuts.
  return value === normalizeFact(claimLabel) ||
    normalizeFact(item.bodyText).includes(value);
}

export function loadCalibratedRetentionV2(): RetentionV2Content[] {
  const items: RawItem[] = RETENTION_LEVELS.flatMap(level =>
    readFileSync(`content/retention-v2/${level}.jsonl`, "utf8")
      .trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as RawItem)
  );
  const overrides = JSON.parse(readFileSync("content/retention-v2/calibration-overrides.json", "utf8")) as {
    schemaVersion: number;
    patches: Patch[];
  };
  if (overrides.schemaVersion !== 1 || !Array.isArray(overrides.patches)) throw Error("Invalid calibration version");
  const ids = new Set(items.map(item => item.sourceId));
  if (items.length !== 75 || ids.size !== 75) throw Error("Retention V2 source must have exactly 75 unique texts");
  const updates = new Set<string>();
  const byId = new Map(items.map(item => [item.sourceId, item]));
  for (const patch of overrides.patches) {
    const item = byId.get(patch.sourceId);
    if (!item) throw Error(`Unknown retention source: ${patch.sourceId}`);
    const key = `${patch.sourceId}/${patch.claimId}`;
    if (updates.has(key)) throw Error(`Duplicate retention correction: ${key}`);
    updates.add(key);
    const structure = item.scoringStructure as {
      schemaVersion: number; maxScore: number;
      claims: Array<{ id: string; label: string; acceptedPhrases: string[] }>;
    };
    const claim = structure.claims.find(c => c.id === patch.claimId);
    if (!claim) throw Error(`Unknown corrected claim: ${key}`);
    if (!Array.isArray(patch.addAcceptedPhrases) || !patch.addAcceptedPhrases.length) throw Error(`Empty correction: ${key}`);
    for (const phrase of patch.addAcceptedPhrases) {
      if (!verifiedPatch(phrase, item, claim.label)) throw Error(`Not grounded in authored facts: ${key}`);
      if (claim.acceptedPhrases.includes(phrase)) throw Error(`Redundant correction: ${key}`);
      claim.acceptedPhrases.push(phrase);
    }
  }
  if (updates.size !== 26) throw Error(`Expected 26 peer-reviewed correction groups, got ${updates.size}`);
  return items.map(item => ({
    sourceId: item.sourceId,
    level: item.level,
    bodyText: item.bodyText,
    scoringStructure: validateMeasurementStructure(item.scoringStructure),
  }));
}
