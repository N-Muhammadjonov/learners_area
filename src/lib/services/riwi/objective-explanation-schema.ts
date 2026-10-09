import { z } from "zod";
export const objectiveExplanationRequestSchema = z.object({
  domain: z.enum(["reading", "listening"]), attemptId: z.string().uuid(), questionId: z.string().uuid(),
}).strict();
export const objectiveExplanationSchema = z.object({
  status: z.enum(["explained", "insufficient_evidence"]),
  domain: z.enum(["reading", "listening"]), attemptId: z.string().uuid(), questionId: z.string().uuid(),
  question: z.string().max(2000), userAnswer: z.string().max(600), officialAnswer: z.string().max(600), isCorrect: z.boolean(),
  explanation: z.string().max(1600).nullable(), evidence: z.string().max(1600).nullable(),
  method: z.string().max(3000),
  provenance: z.object({
    contractKey: z.string().max(120), promptVersion: z.string().max(120), rubricVersion: z.string().max(120),
    providerId: z.literal("authored-source"), model: z.null(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceBasis: z.literal("submission_snapshot"),
  }).strict(),
}).strict();
export type ObjectiveExplanation = z.infer<typeof objectiveExplanationSchema>;
