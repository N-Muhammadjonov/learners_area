import { z } from "zod";

// The sentence-only HTTP boundary cannot accept caller-controlled awards or verdicts.
export const vocabularyUseHttpSchema = z.object({
  sentence: z.string().trim().min(3).max(1000),
}).strict();

// Shared storage also serves longer Writing Activation answers.
export const sentenceUseInputSchema = z.object({
  userId: z.string().uuid(),
  entryId: z.string().uuid(),
  sentence: z.string().trim().min(3).max(20_000),
}).strict();

export const sentenceConfirmationSchema = z.object({
  userId: z.string().uuid(),
  usageId: z.string().uuid(),
  accepted: z.boolean(),
  evaluationId: z.string().uuid(),
  now: z.date().optional(),
  origin: z.enum(["riwi", "external_ai"]).optional(),
  verdict: z.enum(["correct", "mostly_correct", "needs_correction"]).nullable().optional(),
}).strict().refine(input => input.verdict == null || input.accepted === (input.verdict === "correct"));
