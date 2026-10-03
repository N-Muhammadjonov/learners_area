import { z } from "zod";
const vocabulary = z.object({
  word: z.string().min(1).max(120), pos: z.string().max(30).default(""), def: z.string().min(1).max(600),
  uz: z.string().max(300).default(""), ex: z.string().max(600).default(""), surfaces: z.array(z.string().min(1).max(120)).max(10).optional(),
});
const question = z.object({
  questionNo: z.number().int().min(1).max(60),
  type: z.enum(["true_false_not_given", "yes_no_not_given", "multiple_choice", "short_answer"]),
  text: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(300)).max(10).optional(),
  answer: z.string().min(1).max(300),
  accepted: z.array(z.string().min(1).max(300)).max(10).default([]),
  evidence: z.string().max(1000).optional(),
  explanation: z.string().max(2000).default(""),
});
export const generalReadingBundle = z.object({
  sourceRef: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  level: z.string().max(10).optional(),
  publish: z.boolean().default(false),
  passages: z.array(z.object({
    passageNo: z.number().int().min(1).max(3),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(40_000),
    questions: z.array(question).max(40).default([]),
    vocabulary: z.array(vocabulary).max(300).default([]),
  })).min(1).max(3).refine((rows) => new Set(rows.map((row) => row.passageNo)).size === rows.length, "passage numbers must be unique"),
});
export type GeneralReadingBundle = z.infer<typeof generalReadingBundle>;

