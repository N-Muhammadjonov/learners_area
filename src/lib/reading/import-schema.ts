import { z } from "zod";
import { readingQuestionType } from "@/lib/reading/question-model";
export const readingTypeCode = z.string().min(1).max(40).refine(value=>Boolean(readingQuestionType(value)),"Unknown Reading question type");
export const readingConstraint = z.object({max_words:z.number().int().min(1).max(100).optional(),number_allowed:z.boolean().optional(),selection_count:z.number().int().min(1).max(10).optional(),allowed_values:z.array(z.string()).max(30).optional()});
export const readingGroup = z.object({key:z.string().min(1).max(40),typeCode:readingTypeCode,displayTitle:z.string().max(120).optional(),instructionsText:z.string().max(4000).optional(),sharedChoices:z.array(z.string().max(500)).max(30).optional(),fromQuestionNo:z.number().int().min(1).max(60).optional(),toQuestionNo:z.number().int().min(1).max(60).optional()});
const vocabulary = z.object({
  word: z.string().min(1).max(120), pos: z.string().max(30).default(""), def: z.string().min(1).max(600),
  uz: z.string().max(300).default(""), ex: z.string().max(600).default(""), surfaces: z.array(z.string().min(1).max(120)).max(10).optional(),
});
const question = z.object({
  questionNo: z.number().int().min(1).max(60),
  type: readingTypeCode,
  groupKey:z.string().max(40).optional(),
  answerConstraint:readingConstraint.optional(),
  renderMode:z.enum(["shared_stimulus_slot","inline","standalone"]).optional(),
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
    groups:z.array(readingGroup).max(40).optional(),
    questions: z.array(question).max(40).default([]),
    vocabulary: z.array(vocabulary).max(300).default([]),
  }).superRefine((p,ctx)=>{
    const keys=(p.groups??[]).map(g=>g.key);
    if(new Set(keys).size!==keys.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Duplicate group key"});
    if(new Set(p.questions.map(q=>q.questionNo)).size!==p.questions.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Duplicate question number"});
    for(const q of p.questions)if(q.groupKey && !keys.includes(q.groupKey))ctx.addIssue({code:z.ZodIssueCode.custom,message:"Unknown question group"});
  })).min(1).max(3).refine((rows) => new Set(rows.map((row) => row.passageNo)).size === rows.length, "passage numbers must be unique"),
});
export type GeneralReadingBundle = z.infer<typeof generalReadingBundle>;
