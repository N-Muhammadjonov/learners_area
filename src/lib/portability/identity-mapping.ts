import { z } from "zod";

/** Explicit operator mapping, never an archive-supplied authority claim. */
export const portableIdentityMappingSchema = z.array(z.object({
  sourceId: z.string().uuid(), targetId: z.string().uuid(),
}).strict()).max(1000).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.sourceId.toLowerCase())).size !== items.length
    || new Set(items.map(item => item.targetId.toLowerCase())).size !== items.length) {
    ctx.addIssue({ code: "custom", message: "portable_identity_mapping_must_be_one_to_one" });
  }
});

export function portableIdentityMap(value: unknown): ReadonlyMap<string, string> {
  return new Map(portableIdentityMappingSchema.parse(value).map(item => [item.sourceId.toLowerCase(), item.targetId.toLowerCase()]));
}
