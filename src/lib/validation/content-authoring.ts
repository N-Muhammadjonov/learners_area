import { z } from "zod";

/**
 * Request shapes for the content authoring/publication API. Kept apart from the
 * services so a route is a parse, a call and a status code — and so the shapes can
 * be reused by the authoring workspace without importing server code.
 */

export const saveDraftRequestSchema = z.object({
  module: z.string().min(2).max(20),
  contentType: z.string().min(2).max(40),
  sourceRef: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  track: z.enum(["academic", "general_training", "unspecified"]).optional(),
  /** `module:contentType` specific payload; validated by that content type's author. */
  payload: z.unknown(),
  note: z.string().max(500).optional().nullable(),
  versionId: z.string().uuid().optional().nullable(),
});

export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>;

export const publicationRequestSchema = z.object({
  to: z.enum(["draft", "scheduled", "published", "archived"]),
  publishAt: z.string().datetime().optional().nullable(),
});

export type PublicationRequestInput = z.infer<typeof publicationRequestSchema>;
