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
    /** Optional AI-plan scope. The server re-authorizes both ids and prompt membership. */
    sessionId: z.string().uuid().optional(),
    sessionItemId: z.string().uuid().optional(),
    retryOfAttemptId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.sessionId) === Boolean(value.sessionItemId), "session_scope_incomplete");

export const submitAttemptSchema = z
  .object({
    durationMs: z.number().int().positive().max(60 * 60 * 1000).optional(),
    browserTranscript: z.string().trim().min(1).max(8000).optional(),
    browserTranscriptRaw: z.string().trim().min(1).max(8000).optional(),
    browserTranscriptEdited: z.boolean().optional(),
    manualTranscript: z.string().trim().min(10).max(8000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.manualTranscript && value.browserTranscript) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "one_transcript_source", path: ["manualTranscript"] });
    }
    if (value.browserTranscriptEdited && !value.browserTranscriptRaw) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "raw_transcript_required", path: ["browserTranscriptRaw"] });
    }
    if (value.browserTranscriptRaw && !value.browserTranscript) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "browser_transcript_required", path: ["browserTranscript"] });
    }
  });
