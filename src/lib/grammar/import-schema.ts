import { z } from "zod";
const sentence = z.string().trim().min(3).max(12000);
export const grammarBundleSchema = z.object({
  schemaVersion: z.literal(1),
  provenance: z.string().trim().min(3).max(500),
  topics: z.array(z.object({
    skillArea: z.enum(["writing", "speaking"]), title: sentence.max(200), explanation: sentence,
    exercises: z.array(z.object({
      promptText: sentence, options: z.array(sentence.max(600)).min(2).max(6), correctOption: sentence.max(600),
      explanation: sentence, translatePromptUz: sentence.max(1000), targetStructures: z.array(sentence.max(100)).min(1).max(10),
      activationPrompt: sentence.max(1000),
    }).strict().refine(row => new Set(row.options).size === row.options.length && row.options.includes(row.correctOption), "Correct answer must be one unique option")).min(1).max(100),
  }).strict()).min(1).max(20),
}).strict().superRefine((bundle, context) => {
  const keys = bundle.topics.map(topic => `${topic.skillArea}:${topic.title.toLowerCase()}`);
  if (new Set(keys).size !== keys.length) context.addIssue({code: "custom", message: "Duplicate topic"});
});
export type GrammarBundle = z.infer<typeof grammarBundleSchema>;
