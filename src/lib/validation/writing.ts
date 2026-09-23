import { z } from "zod";

export const saveDraftSchema = z.object({
  submissionId: z.string().uuid(),
  content: z.string().max(20000),
});

export const createSubmissionSchema = z.object({
  promptId: z.string().uuid(),
});

export const submitEssaySchema = z.object({
  submissionId: z.string().uuid(),
});
