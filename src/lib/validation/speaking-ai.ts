import { z } from "zod";

/**
 * Validation for Practice with AI sessions (spec §42–§44).
 *
 * Every schema is `.strict()`, which is the enforcement mechanism for the
 * trust boundary rather than a stylistic choice: a field the server is supposed
 * to derive becomes a 400 the moment a client tries to supply it.
 *
 * Deliberately NOT accepted anywhere in this file:
 *   - `userId` / `role`      — identity comes from the authenticated session
 *   - `plan` / `items` / `seed` — the plan is built server-side and persisted;
 *     a client-supplied plan would let a learner pick their own questions
 *   - `transcriptOrigin`, `provider`, `model`, `checkedBy`, `band`, `score`
 *     — provenance and results are server-derived, never client-asserted
 */

/**
 * The four session modes. Kept as a literal tuple so zod can enumerate it;
 * `tests/speaking-ai-session-plan.test.ts` asserts it stays identical to
 * `SESSION_PLAN_MODES`, which is what stops the two from drifting apart.
 */
export const sessionModeSchema = z.enum(["full", "part1", "part2", "part3"]);
export type SessionModeInput = z.infer<typeof sessionModeSchema>;

export const createAiSessionSchema = z
  .object({
    mode: sessionModeSchema,
  })
  .strict();

/**
 * Binding an answer to a plan item. Only the attempt id crosses the boundary:
 * the server re-checks that the attempt belongs to this learner, that it targets
 * the item's own prompt, and that it was really submitted.
 */
export const completeAiSessionItemSchema = z
  .object({
    attemptId: z.string().uuid(),
  })
  .strict();

/**
 * Skipping a question records the skip and moves the cursor. It accepts nothing:
 * a skip must never be able to carry an answer, a transcript or a band.
 */
export const skipAiSessionItemSchema = z.object({}).strict();

/** Finishing a session computes the summary server-side from stored rows. */
export const completeAiSessionSchema = z.object({}).strict();

export const listAiSessionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
