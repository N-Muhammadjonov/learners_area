import { z } from "zod";
import { reportSnapshotSchema } from "@/lib/reporter/snapshot-schema";
import {
  criterionSchema,
  evaluationIssueSchema,
  evaluationVerdictSchema,
  recommendedExerciseSchema,
} from "@/lib/services/coach/schema";

export const RIWI_TARGET_CURSOR_MAX_LENGTH = 2048;

export const RIWI_PROVENANCE = [
  "canonical_dictionary", "canonical_evaluation", "canonical_grammar", "approved_knowledge", "course_lesson", "deterministic_learning_data",
  "deterministic_report", "external_provider", "policy_refusal", "unavailable",
] as const;
export type RiwiProvenance = (typeof RIWI_PROVENANCE)[number];

export const RIWI_INTENTS = [
  "dictionary_lookup",
  "dictionary_explain",
  "progress_self",
  "report_self",
  "educational_explanation",
  "knowledge_query",
  "course_lesson",
  "provider_status",
  "provider_benchmark",
  "owner_action",
  "evaluate_writing",
  "evaluate_speaking",
  "evaluate_grammar",
  "evaluate_vocabulary",
  "unsupported",
  "security_denial",
  "unknown",
] as const;
export type RiwiIntent = (typeof RIWI_INTENTS)[number];

/** Exact occurrence context is a lookup hint only; the server resolves access, sense, and exam state afresh. */
export const riwiDictionaryOccurrenceSchema = z.object({
  sourceType: z.enum(["reading", "listening"]),
  sourceId: z.string().uuid(),
  occurrenceId: z.string().uuid(),
}).strict();
export type RiwiDictionaryOccurrence = z.infer<typeof riwiDictionaryOccurrenceSchema>;

/** Public, bounded projection of the canonical Coach result; internal provider identifiers remain server-side. */
export const riwiEvaluationSchema = z.object({
  evaluationId: z.string().uuid(),
  evaluationType: z.enum(["writing", "speaking", "grammar", "vocabulary"]),
  overallEstimate: z.number().min(0).max(9).nullable(),
  confidence: z.number().min(0).max(1),
  verdict: evaluationVerdictSchema.nullable(),
  criteria: z.array(criterionSchema).max(12),
  strengths: z.array(z.string().min(1).max(400)).max(12),
  weaknesses: z.array(z.string().min(1).max(400)).max(12),
  issues: z.array(evaluationIssueSchema).max(30),
  nextActions: z.array(z.string().min(1).max(400)).max(12),
  recommendedExercises: z.array(recommendedExerciseSchema).max(8),
  checkedBy: z.string().min(1).max(80),
  promptVersion: z.string().min(1).max(40),
  rubricVersion: z.string().min(1).max(40),
  fallbackUsed: z.boolean(),
  createdAt: z.string().datetime(),
}).strict();
export type RiwiEvaluation = z.infer<typeof riwiEvaluationSchema>;

export const riwiDictionaryResultSchema = z.object({
  canonicalLexemeId: z.string().uuid(),
  senseId: z.string().uuid(),
  term: z.string().max(120),
  definitionEn: z.string().max(4000),
  translationUz: z.string().max(2000).nullable(),
  partOfSpeech: z.string().max(80).nullable(),
  lexicalType: z.string().max(24).nullable(),
  source: z.string().max(240),
  verified: z.boolean(),
  occurrence: z.object({
    occurrenceId: z.string().uuid(),
    sourceType: z.enum(["reading", "listening", "video"]).optional(),
    sourceTitle: z.string().max(240),
    surfaceForm: z.string().max(120),
    sentenceText: z.string().max(600),
    sectionNumber: z.number().int().nullable().optional(),
    startMs: z.number().int().nullable().optional(),
    endMs: z.number().int().nullable().optional(),
  }).strict().nullable(),
}).strict();
export type RiwiDictionaryResult = z.infer<typeof riwiDictionaryResultSchema>;

/**
 * `targetUserId` is a requested row, never an actor identity; the server must
 * resolve it through the role capability and live roster/scope policy. The
 * authenticated actor, role, provider, tool and endpoint are never accepted.
 */
export const riwiChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  targetUserId: z.string().uuid().optional(),
  dictionaryOccurrence: riwiDictionaryOccurrenceSchema.optional(),
}).strict();
export type RiwiChatRequest = z.infer<typeof riwiChatRequestSchema>;

/** Presentation-only scope options; every target is re-authorized by the gateway. */
export const riwiRoleSurfaceSchema = z.object({
  status: z.enum(["ready", "unavailable"]),
  role: z.enum(["student", "teacher", "admin", "owner"]),
  scope: z.enum(["self", "assigned_roster", "admin_cohort", "owner_centre"]),
  targetOptions: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(120) }).strict()).max(100),
  nextCursor: z.string().max(RIWI_TARGET_CURSOR_MAX_LENGTH).nullable(),
}).strict();
export type RiwiRoleSurface = z.infer<typeof riwiRoleSurfaceSchema>;

export const riwiChatResponseSchema = z.object({
  ok: z.boolean(),
  correlationId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  intent: z.enum(RIWI_INTENTS),
  answer: z.string().max(6000),
  uncertainty: z.string().max(600).nullable(),
  citations: z.array(z.object({ source: z.string().max(120), version: z.number().int().positive().nullable() }).strict()).max(8),
  attribution: z.literal("RIWI"),
  provenance: z.enum(RIWI_PROVENANCE),
  provider: z.object({ id: z.string().max(60), model: z.string().max(120).nullable() }).strict().nullable(),
  reportSnapshot: reportSnapshotSchema.optional(),
  evaluation: riwiEvaluationSchema.optional(),
  dictionaryEntry: riwiDictionaryResultSchema.optional(),
  errorCode: z.string().max(80).nullable(),
}).strict();
export type RiwiChatResponse = z.infer<typeof riwiChatResponseSchema>;

const RESTRICTED_PATTERNS = [
  /\b(drop|truncate|alter)\s+(table|database|schema)\b/i,
  /\b(database_url|service[_ -]?role|provider[_ -]?key|api[_ -]?key|r2[_ -]?secret|ssh[_ -]?key)\b/i,
  /\b(shell|terminal|run command|execute code|edit source code|modify source code|arbitrary sql|read system prompt)\b/i,
  /(?:\bread|cat|print|dump|open|show|copy).{0,80}(?:\.env\b|environment variables|source code|credential files|private keys?|provider keys?|database url)/i,
  /\b(other students?|another student|all learners?|every learners?|other users?).{0,80}\b(emails?|phones?|telegram|passwords?|records?|data|reports?|progress|results?)\b/i,
  /\b(send|upload|exfiltrate|post).{0,80}\b(database|learner data|student data|private data)\b/i,
  /\b(password|credentials|secret|token|database_url|provider key|api key|ssh key|r2 secret|parol|kalit|maxfiy|buyruq|terminal)\b/i,
  /(парол|секрет|ключ(?:и|ей)?|база данных|терминал|оболочк|командн|чуж(?:ой|ого|их) ученик|все ученики|покажи.{0,30}учетн)/i,
  /(boshqa o'quvchi|barcha o'quvchi|boshqa talaba|ma'lumotlar bazasi|maxfiy ma'lumot|parollar|boshqa foydalanuvchi)/i,
];

export type RiwiIntentAssessment = { intent: RiwiIntent; confidence: number };

/**
 * Finite deterministic classification with an explicit confidence floor. This
 * only chooses a registered intent; it can never emit a tool/provider name.
 * Low-confidence free text returns `unknown` and is clarified without execution.
 */
export function assessRiwiIntent(message: string): RiwiIntentAssessment {
  const input = message.trim();
  if (!input) return { intent: "unknown", confidence: 0 };
  if (RESTRICTED_PATTERNS.some((pattern) => pattern.test(input))) return { intent: "security_denial", confidence: 1 };
  if (/\b(compare|benchmark|test)\b.{0,50}\b(providers?|models?)\b|\b(provider|model)\b.{0,50}\b(benchmark|compare|test)\b/i.test(input)) {
    return { intent: "provider_benchmark", confidence: 0.94 };
  }
  if (/\b(provider|external ai|model)\b.{0,40}\b(status|readiness|configuration|configured|available)\b|\b(status|readiness)\b.{0,40}\b(provider|external ai|model)\b/i.test(input)) {
    return { intent: "provider_status", confidence: 0.94 };
  }
  if (/\b(approve|promote|reject|publish|supersede|delete|transfer|suspend|change role)\b.{0,60}\b(knowledge|material|source|learner|student|account|owner|content|role)\b/i.test(input)) {
    return { intent: "owner_action", confidence: 0.92 };
  }
  if (/\b(search the web|browse (?:the )?internet|latest news|live weather|draw (?:me )?(?:a )?(?:picture|image)|generate (?:an? )?image|play (?:a )?game)\b/i.test(input)) {
    return { intent: "unsupported", confidence: 0.9 };
  }
  if (/\b(grade|evaluate|check)\b.{0,40}\b(my )?(essay|writing|speaking|grammar|vocabulary)\b|\b(my )?(essay|writing)\b.{0,30}\b(grade|evaluate|check)\b/i.test(input)) {
    const intent: RiwiIntent = /\b(speaking)\b/i.test(input) ? "evaluate_speaking"
      : /\b(grammar)\b/i.test(input) ? "evaluate_grammar"
        : /\b(vocabulary)\b/i.test(input) ? "evaluate_vocabulary" : "evaluate_writing";
    return { intent, confidence: 0.93 };
  }
  if (/\b(progress|my progress|how am i doing|what should i practise|practice recommendation|weakness)\b/i.test(input)
      || /(?:mening|shaxsiy).{0,30}(?:progress|rivojlanish|o'sish|natijalar)/i.test(input)
      || /\b(qanday o'rganyapman|nimani mashq qilay|zaif tomonlarim)\b/i.test(input)) return { intent: "progress_self", confidence: 0.93 };
  if (/\b(report|usage today|how many learners|analytics|statistics|numbers)\b/i.test(input)
      || /\b(hisobot|statistika|natijalar|qancha o'quvchi|markaz ko'rsatkichi)\b/i.test(input)
      || /(отч[её]т|статистик|сколько учеников|мои результаты)/i.test(input)) return { intent: "report_self", confidence: 0.9 };
  if (/\b(meaning of|define|definition of|translate|translation of|what does .+ mean|dictionary|collocation)\b/i.test(input)
      || /\b(nima degani|ma'nosi|ma'nosini|tarjima qil|tarjimasi|lug'at|so'zini izohla)\b/i.test(input)
      || /(что значит|переведи|перевод слова|словарь)/i.test(input)) return { intent: "dictionary_lookup", confidence: 0.96 };
  if (/\b(?:course|lesson|unit|module|coursework|class notes?|course notes?|learning material|uploaded (?:file|document|notes?))\b/i.test(input)
      || /(?:kurs|dars|bo'lim|modul|o'quv materiali|yuklangan (?:fayl|hujjat|konspekt)|курс|урок|модул|учебн(?:ый|ого) материал|загруженн(?:ый|ого) документ)/i.test(input)) {
    return { intent: "course_lesson", confidence: 0.9 };
  }
  if (/\b(approved|course|learning)\s+(material|notes?|policy|source)|\b(knowledge base|approved source|centre policy)\b/i.test(input)) {
    return { intent: "knowledge_query", confidence: 0.9 };
  }
  if (/\b(explain|why|how does|what is|teach me|grammar|vocabulary|phrase)\b/i.test(input)
      || /\b(tushuntir|izohla|qanday ishlaydi|grammatika|gap tuzilishi|misol bilan)\b/i.test(input)
      || /(объясни|почему|как работает|грамматик)/i.test(input)) return { intent: "dictionary_explain", confidence: 0.82 };
  return { intent: "unknown", confidence: 0.25 };
}

export function classifyRiwiIntent(message: string): RiwiIntent {
  return assessRiwiIntent(message).intent;
}
