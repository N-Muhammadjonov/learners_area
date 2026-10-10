import { z } from "zod";

export const vocabularyReviewHttpSchema = z.object({
  outcome: z.enum(["correct", "incorrect"]),
}).strict();

export const scheduledReviewInputSchema = vocabularyReviewHttpSchema.extend({
  userId: z.string().uuid(),
  entryId: z.string().uuid(),
  // Only server callers can supply a clock; HTTP accepts outcome alone.
  now: z.date().optional(),
}).strict();
