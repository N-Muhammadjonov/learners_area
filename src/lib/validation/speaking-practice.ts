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
    /**
     * "Try again" (§30): the attempt this one replaces. Recorded on the new row
     * as `retry_of_attempt_id`, so a retake is always a NEW attempt and the one
     * it replaced is never overwritten — the lineage survives for history and for
     * the AI session's rebind check. The route verifies the referenced attempt
     * belongs to the caller and was really submitted.
     */
    retryOfAttemptId: z.string().uuid().nullish(),
  })
  .strict();

export const submitAttemptSchema = z
  .object({
    durationMs: z.number().int().positive().max(60 * 60 * 1000).optional(),
    /**
     * Practice with AI only (§13–§18): the learner's own browser
     * SpeechRecognition output, sent when they press "Send to RIWI".
     *
     * Two fields, because the review step is the point. `browserTranscriptRaw`
     * is exactly what the browser produced; `browserTranscript` is what the
     * learner chose to send after reading it. The server compares them to derive
     * `transcriptEdited`, so a client boolean asserting "unedited" is not
     * accepted — and `.strict()` means sending one is a 400.
     *
     * Still absent, as before: `transcript`, `transcriptOrigin`, `score`, `band`
     * and any provider identity. Those are server-derived (§43).
     */
    browserTranscriptRaw: z.string().max(8000).optional(),
    browserTranscript: z.string().max(8000).optional(),
  })
  .strict();
