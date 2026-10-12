import { legacySenseKeyOf, senseKeyOf } from "./dedupe";

type Sense = { term: string; partOfSpeech?: string | null; definitionEn: string };

/** Preserve historic keys where unambiguous, use full identities for collisions.
 * Neither definition nor source occurrence is rewritten or silently merged.
 */
export function planImportSenseKeys(rows: Sense[]) {
  const fullByLegacy = new Map<string, Set<string>>();
  const identities = rows.map((row) => {
    const input = { term: row.term, partOfSpeech: row.partOfSpeech, meaning: row.definitionEn };
    const legacy = legacySenseKeyOf(input);
    const full = senseKeyOf(input);
    const meanings = fullByLegacy.get(legacy) ?? new Set<string>();
    meanings.add(full);
    fullByLegacy.set(legacy, meanings);
    return { legacy, full };
  });
  return identities.map(({ legacy, full }) => ({
    legacyKey: legacy,
    senseKey: fullByLegacy.get(legacy)!.size > 1 ? full : legacy,
    collisionResolved: fullByLegacy.get(legacy)!.size > 1,
  }));
}
