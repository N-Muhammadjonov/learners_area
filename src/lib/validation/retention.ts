import { z } from "zod";

/**
 * Request shapes for the Retention API.
 *
 * Zod owns the SHAPE (a string is a string, a level is a level, a page is a
 * page). The AUTHORING RULES — the level's word range, the 100-point
 * conservation, the group/claim arithmetic — live in
 * `src/lib/data/retention-bank.ts` and `src/lib/retention/measurement.ts`,
 * because the same rules must apply to the editor's live validation, the save
 * route and the importer, and a copy per route is how those three drift apart.
 */

const scoringStructureField = z.union([z.string().max(200_000), z.record(z.unknown())]);

export const createRetentionTextSchema = z.object({
  level: z.string().min(1).max(4),
  bodyText: z.string().min(1).max(8_000),
  scoringStructure: scoringStructureField,
});

export const createRetentionVersionSchema = z.object({
  bodyText: z.string().min(1).max(8_000),
  scoringStructure: scoringStructureField,
  /** Stale-editor guard: the version the editor opened (§145). */
  expectedCurrentVersionId: z.string().uuid().optional(),
});

export const retentionActiveSchema = z.object({ active: z.boolean() });

export const retentionListQuerySchema = z.object({
  level: z.string().min(1).max(4),
  filter: z.enum(["all", "active", "archived"]).optional(),
  sort: z.enum(["label", "uses", "newest"]).optional(),
});

export type CreateRetentionTextInput = z.infer<typeof createRetentionTextSchema>;
