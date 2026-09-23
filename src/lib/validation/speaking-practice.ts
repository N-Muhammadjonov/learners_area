import { z } from "zod";

/**
 * Validation for the Speaking practice/recording workflow.
 *
 * All three schemas are `.strict()` on purpose. There is no transcription or
 * scoring provider behind this feature, so a `transcript` or a `score` field in
 * a request body can only ever be fabricated data; refusing it is what keeps
 * the UI from later presenting an invented assessment as a real one.
 */
export const listPromptsQuerySchema = z
  .object({
    part: z.enum(["part1", "part2", "part3", "general"]).optional(),
  })
  .strict();

export const createAttemptSchema = z
  .object({
    promptId: z.string().uuid().nullish(),
    /** Free practice with no prompt at all is allowed; the part still has to be declared. */
    part: z.enum(["part1", "part2", "part3", "general"]),
  })
  .strict();

export const submitAttemptSchema = z
  .object({
    durationMs: z.number().int().positive().max(60 * 60 * 1000).optional(),
  })
  .strict();
