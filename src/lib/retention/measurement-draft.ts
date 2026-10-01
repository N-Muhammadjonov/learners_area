import { z } from "zod";
import type { MeasurementStructureV1 } from "./types";
// Allows incomplete FORM drafts. This is NOT the authoritative save validator.
// Unknown properties/versions remain in raw JSON rather than being discarded.
const group = z.object({ id: z.string(), points: z.number().finite(), kind: z.enum(["concept", "entity", "number", "date"]), anyOf: z.array(z.string()).max(30), critical: z.boolean().optional() }).strict();
const claim = z.object({ id: z.string(), label: z.string(), points: z.number().finite(), scope: z.enum(["sentence", "answer"]), groups: z.array(group).max(20), acceptedPhrases: z.array(z.string()).max(20).optional(), rejectPhrases: z.array(z.string()).max(20).optional() }).strict();
const draft = z.object({ schemaVersion: z.literal(1), maxScore: z.literal(100), claims: z.array(claim).max(40) }).strict();
export function decodeMeasurementDraft(raw: string): MeasurementStructureV1 | null {
 if (raw.length > 200_000) return null;
 if (!raw.trim()) return { schemaVersion: 1, maxScore: 100, claims: [] };
 try {
  const result = draft.safeParse(JSON.parse(raw));
  if (!result.success) return null;
  return { ...result.data, claims: result.data.claims.map(c => ({ ...c, acceptedPhrases: c.acceptedPhrases ?? [], rejectPhrases: c.rejectPhrases ?? [], groups: c.groups.map(g => ({ ...g, critical: g.critical ?? false })) })) };
 } catch { return null; }
}
export function measurementLines(raw: string): string[] { return raw === "" ? [] : raw.split("\n"); }
