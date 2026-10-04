import { z } from "zod";

export const RIWI_INTENTS = [
  "dictionary_lookup",
  "dictionary_explain",
  "progress_self",
  "report_self",
  "educational_explanation",
  "security_denial",
  "unknown",
] as const;
export type RiwiIntent = (typeof RIWI_INTENTS)[number];

/** Client payload contains no actor, role, target id, provider, or tool name. */
export const riwiChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
}).strict();
export type RiwiChatRequest = z.infer<typeof riwiChatRequestSchema>;

export const riwiChatResponseSchema = z.object({
  ok: z.boolean(),
  correlationId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  intent: z.enum(RIWI_INTENTS),
  answer: z.string().max(6000),
  uncertainty: z.string().max(600).nullable(),
  citations: z.array(z.object({ source: z.string().max(120), version: z.number().int().positive().nullable() }).strict()).max(8),
  attribution: z.literal("RIWI"),
  provenance: z.enum(["canonical_dictionary", "deterministic_learning_data", "deterministic_report", "external_provider", "policy_refusal", "unavailable"]),
  provider: z.object({ id: z.string().max(60), model: z.string().max(120).nullable() }).strict().nullable(),
  errorCode: z.string().max(80).nullable(),
}).strict();
export type RiwiChatResponse = z.infer<typeof riwiChatResponseSchema>;

const RESTRICTED_PATTERNS = [
  /\b(drop|truncate|alter)\s+(table|database|schema)\b/i,
  /\b(database_url|service[_ -]?role|provider[_ -]?key|api[_ -]?key|r2[_ -]?secret|ssh[_ -]?key)\b/i,
  /\b(shell|terminal|run command|execute code|edit source code|modify source code|arbitrary sql|read system prompt)\b/i,
  /(?:\bread|cat|print|dump|open|show|copy).{0,80}(?:\.env\b|environment variables|source code|credential files|private keys?|provider keys?|database url)/i,
  /\b(other students?|another student|all learners?|every learners?|other users?).{0,80}\b(emails?|phones?|telegram|passwords?|records?|data|reports?)\b/i,
  /\b(send|upload|exfiltrate|post).{0,80}\b(database|learner data|student data|private data)\b/i,
  /\b(password|credentials|secret|token|database_url|provider key|api key|ssh key|r2 secret|parol|kalit|maxfiy|buyruq|terminal)\b/i,
  /(парол|секрет|ключ(?:и|ей)?|база данных|терминал|оболочк|командн|чуж(?:ой|ого|их) ученик|все ученики|покажи.{0,30}учетн)/i,
  /(boshqa o'quvchi|barcha o'quvchi|boshqa talaba|ma'lumotlar bazasi|maxfiy ma'lumot|parollar|boshqa foydalanuvchi)/i,
];

/** Finite deterministic classifier. It never emits a tool name or a user id. */
export function classifyRiwiIntent(message: string): RiwiIntent {
  const input = message.trim();
  if (!input) return "unknown";
  if (RESTRICTED_PATTERNS.some((pattern) => pattern.test(input))) return "security_denial";
  if (/\b(progress|my progress|how am i doing|what should i practise|practice recommendation|weakness)\b/i.test(input)
      || /(?:mening|shaxsiy).{0,30}(?:progress|rivojlanish|o'sish|natijalar)/i.test(input)
      || /\b(qanday o'rganyapman|nimani mashq qilay|zaif tomonlarim)\b/i.test(input)) return "progress_self";
  if (/\b(report|usage today|how many learners|analytics|statistics|numbers)\b/i.test(input)
      || /\b(hisobot|statistika|natijalar|qancha o'quvchi|markaz ko'rsatkichi)\b/i.test(input)
      || /(отч[её]т|статистик|сколько учеников|мои результаты)/i.test(input)) return "report_self";
  if (/\b(meaning of|define|definition of|translate|translation of|what does .+ mean|dictionary|collocation)\b/i.test(input)
      || /\b(nima degani|ma'nosi|ma'nosini|tarjima qil|tarjimasi|lug'at|so'zini izohla)\b/i.test(input)
      || /(что значит|переведи|перевод слова|словарь)/i.test(input)) return "dictionary_lookup";
  if (/\b(explain|why|how does|what is|teach me|grammar|vocabulary|phrase)\b/i.test(input)
      || /\b(tushuntir|izohla|qanday ishlaydi|grammatika|gap tuzilishi|misol bilan)\b/i.test(input)
      || /(объясни|почему|как работает|грамматик)/i.test(input)) return "dictionary_explain";
  return "educational_explanation";
}
