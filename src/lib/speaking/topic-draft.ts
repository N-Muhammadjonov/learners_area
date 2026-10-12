import { z } from "zod";
import { speakingPromptDraft } from "./study-support";
export const speakingTopicIdentity = z.object({
  part: z.enum(["part1", "part2", "part3"]), topic: z.string().max(200).nullable(),
  bank: z.enum(["shared", "ai"]), ids: z.array(z.string().uuid()).min(1).max(2000),
});
export const speakingTopicDraft = z.object({
  original: speakingTopicIdentity.optional(),
  questions: z.array(speakingPromptDraft).min(1).max(100),
}).superRefine(({ questions, original }, ctx) => {
  const first = questions[0];
  if (!first) return;
  if (questions.some(q => q.part !== first.part || q.topic !== first.topic || JSON.stringify([...q.availableIn].sort()) !== JSON.stringify([...first.availableIn].sort()))) ctx.addIssue({code: "custom", message: "Questions must belong to one topic and bank"});
  if (first.part === "part2" && questions.length !== 1) ctx.addIssue({code: "custom", message: "A cue-card topic has one question"});
  const ids = questions.flatMap(q => q.id ? [q.id] : []);
  if (new Set(ids).size !== ids.length || ids.some(id => !original?.ids.includes(id))) ctx.addIssue({code: "custom", message: "Invalid question identity"});
});
