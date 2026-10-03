import { z } from "zod";
import { PATTERN_FUNCTIONS } from "./pattern-functions";
import { TRANSLATION_BANDS, TRANSLATION_QUESTION_TYPES } from "./translation-rules";

/**
 * Writing Management content contract (Part J). One schema per managed kind,
 * shared by the API (request shape) and the service (domain validation), so
 * the two cannot drift. Database CHECKs in 0031 mirror these limits.
 */
export const WRITING_ADMIN_KINDS = ["lesson", "prompt", "translation", "model-text", "pattern"] as const;
export type WritingAdminKind = (typeof WRITING_ADMIN_KINDS)[number];
export function isWritingAdminKind(v: unknown): v is WritingAdminKind {
  return typeof v === "string" && (WRITING_ADMIN_KINDS as readonly string[]).includes(v);
}

/** Publication endpoint type name for each kind (one shared publication rule). */
export const PUBLICATION_TYPE: Record<WritingAdminKind, string> = {
  lesson: "writing-lesson", prompt: "writing", translation: "writing-translation", "model-text": "writing-model-text", pattern: "writing-pattern",
};

export const LESSON_CATEGORIES = ["task1", "task2", "structure", "ideas", "coherence", "vocabulary", "grammar", "mistakes"] as const;
export const MODEL_TEXT_BANDS = [8, 8.5, 9] as const;
/** A complete model essay — never a question prompt pretending to be one. */
export const MODEL_TEXT_MIN_WORDS = { task1: 150, task2: 250 } as const;

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const taskType = z.enum(["task1", "task2"]);

export const lessonInput = z.object({
  title: trimmed(200),
  category: z.enum(LESSON_CATEGORIES),
  summary: optionalText(600),
  body: trimmed(20000),
  durationMinutes: z.coerce.number().int().min(1).max(240).nullish().transform((v) => v ?? null),
  position: z.coerce.number().int().min(0).max(10000).default(0),
}).strict();

export const promptInput = z.object({
  taskType,
  category: trimmed(60),
  prompt: z.string().trim().min(10).max(2000),
  targetWordCount: z.coerce.number().int().min(50).max(500),
}).strict();

export const translationSentenceInput = z.object({
  position: z.coerce.number().int().min(1).max(40),
  uzbekSource: trimmed(600),
  modelEnglish: trimmed(600),
  acceptedAlternatives: z.array(z.string().trim().min(1).max(600)).max(10).default([]),
  notes: z.array(z.string().trim().min(1).max(400)).max(5).default([]),
  targetLexicalItems: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
}).strict();

export const translationInput = z.object({
  title: trimmed(200),
  topic: trimmed(120),
  questionType: z.enum(TRANSLATION_QUESTION_TYPES),
  taskType: taskType.default("task2"),
  targetBand: z.coerce.number().int().refine((b) => (TRANSLATION_BANDS as readonly number[]).includes(b)),
  promptText: trimmed(2000),
  provenance: trimmed(200),
  sentences: z.array(translationSentenceInput).max(40),
}).strict();

export const modelTextInput = z.object({
  title: trimmed(200),
  taskType,
  topic: trimmed(120),
  targetBand: z.coerce.number().refine((b) => (MODEL_TEXT_BANDS as readonly number[]).includes(b)),
  body: z.string().trim().min(200).max(8000),
  provenance: trimmed(200),
}).strict();

export const patternInput = z.object({
  pattern: trimmed(240),
  function: z.enum(PATTERN_FUNCTIONS),
  taskType,
  topic: optionalText(120),
  targetBand: z.coerce.number().int().min(5).max(9).nullish().transform((v) => v ?? null),
  example: trimmed(400),
  usageNote: optionalText(600),
  sourceRef: z.string().uuid().nullish().transform((v) => v ?? null),
  provenance: trimmed(200),
}).strict();

export const ADMIN_INPUT = { lesson: lessonInput, prompt: promptInput, translation: translationInput, "model-text": modelTextInput, pattern: patternInput } as const;
export type AdminInput<K extends WritingAdminKind> = z.infer<(typeof ADMIN_INPUT)[K]>;

/** Staff-facing problem codes; the UI maps each to a UZ/EN sentence (never a raw code). */
export const ADMIN_ISSUES = [
  "invalid_fields", "not_found", "duplicate_position", "no_sentences", "missing_uzbek", "missing_model",
  "model_too_short", "missing_provenance", "missing_example", "unknown_source", "task1_visual_missing", "empty_body", "write_failed",
] as const;
export type AdminIssue = (typeof ADMIN_ISSUES)[number];

export function wordsIn(text: string): number {
  return (text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) ?? []).length;
}
