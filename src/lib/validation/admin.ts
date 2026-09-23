import { z } from "zod";

export const createPassageSchema = z.object({
  title: z.string().min(3).max(200),
  bodyText: z.string().min(50),
  difficultyLevel: z.string().min(2).max(10),
  suggestedMinutes: z.coerce.number().int().min(5).max(90),
});

export const createReadingQuestionSchema = z
  .object({
    type: z.enum(["true_false_not_given", "yes_no_not_given", "multiple_choice", "short_answer"]),
    questionText: z.string().min(5),
    options: z.array(z.string().min(1)).optional(),
    correctAnswer: z.string().min(1),
    evidenceQuote: z.string().optional(),
    explanation: z.string().min(1),
  })
  .refine((v) => v.type !== "multiple_choice" || (v.options && v.options.length >= 2), {
    message: "multiple_choice needs at least 2 options",
    path: ["options"],
  });

export const createGrammarTopicSchema = z.object({
  skillArea: z.enum(["writing", "speaking"]),
  title: z.string().min(3).max(200),
  explanation: z.string().min(5),
});

export const createGrammarExerciseSchema = z.object({
  promptText: z.string().min(3),
  options: z.array(z.string().min(1)).min(2).max(6),
  correctOption: z.string().min(1),
  explanation: z.string().min(3),
  sourceSubmissionId: z.string().uuid().optional(),
});

export const createListeningTestSchema = z.object({
  title: z.string().min(3).max(200),
  audioType: z.enum(["video", "audio", "file", "link"]),
  audioUrl: z.string().url(),
  transcript: z.string().optional(),
  difficultyLevel: z.string().min(2).max(10),
});

export const createListeningQuestionSchema = z
  .object({
    type: z.enum(["multiple_choice", "short_answer"]),
    questionText: z.string().min(5),
    options: z.array(z.string().min(1)).optional(),
    correctAnswer: z.string().min(1),
    explanation: z.string().min(1),
  })
  .refine((v) => v.type !== "multiple_choice" || (v.options && v.options.length >= 2), {
    message: "multiple_choice needs at least 2 options",
    path: ["options"],
  });
