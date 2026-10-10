import { z } from "zod";
import { GAME_IDS } from "./game-routes";

export const VOCAB_GAME_SETS = ["all", "due", "weak", "reading", "listening", "topic", "folder", "assigned"] as const;

// Empty answers are valid practice and are graded wrong by the shared grader.
export const gameSubmissionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("spelling"), text: z.string().max(300) }).strict(),
  z.object({ kind: z.literal("sentence"), text: z.string().max(600) }).strict(),
  z.object({ kind: z.literal("pair"), pairEntryId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("self"), known: z.boolean() }).strict(),
]);

export const vocabularyGameAnswerHttpSchema = z.object({
  entryId: z.string().uuid(),
  set: z.enum(VOCAB_GAME_SETS),
  gameId: z.enum(GAME_IDS),
  folderId: z.string().uuid().optional(),
  topicPack: z.string().max(100).optional(),
  submission: gameSubmissionSchema,
}).strict();

// Identity and time belong to authenticated server callers, never the HTTP body.
export const gameAnswerInputSchema = vocabularyGameAnswerHttpSchema.omit({ set: true }).extend({
  userId: z.string().uuid(),
  setKey: z.enum(VOCAB_GAME_SETS),
  now: z.date().optional(),
}).strict();
