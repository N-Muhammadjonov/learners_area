import { z } from "zod";
import { ACTIVATION_LEVELS } from "./activation-rules";

/** POST /api/writing/activation/check body. Levels are Activation-only (5.5–7.5+). */
export const activationCheckBody = z.object({
  sessionId: z.string().uuid(),
  entryId: z.string().uuid().nullish(),
  customTerm: z.string().max(80).nullish(),
  mode: z.enum(["writing", "speaking"]),
  targetLevel: z.enum(ACTIVATION_LEVELS),
  uzbekPrompt: z.boolean(),
  upgradeFrom: z.string().max(600).nullish(),
  answer: z.string().min(1).max(600),
}).strict().refine((b) => Boolean(b.entryId) !== Boolean(b.customTerm), { message: "one item" });

/** POST /api/writing/activation/items body: own-list terms to resolve against MY Vocabulary. */
export const activationResolveBody = z.object({ terms: z.array(z.string().max(120)).min(1).max(30) }).strict();
