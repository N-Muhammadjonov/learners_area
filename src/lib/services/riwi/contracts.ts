import { z } from "zod";

export const RIWI_INTENTS = [
  "dictionary_lookup",
  "dictionary_explain",
  "progress_self",
  "report_self",
  "educational_explanation",
  "knowledge_query",
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

/**
 * `targetUserId` is a requested row, never an actor identity; the server must
 * resolve it through the role capability and live roster/scope policy. The
 * authenticated actor, role, provider, tool and endpoint are never accepted.
 */
export const riwiChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  targetUserId: z.string().uuid().optional(),
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
  if (/\b(approved|course|learning)\s+(material|notes?|policy|source)|\b(knowledge base|approved source|centre policy)\b/i.test(input)) {
    return { intent: "knowledge_query", confidence: 0.86 };
  }
  if (/\b(explain|why|how does|what is|teach me|grammar|vocabulary|phrase)\b/i.test(input)
      || /\b(tushuntir|izohla|qanday ishlaydi|grammatika|gap tuzilishi|misol bilan)\b/i.test(input)
      || /(объясни|почему|как работает|грамматик)/i.test(input)) return { intent: "dictionary_explain", confidence: 0.82 };
  return { intent: "unknown", confidence: 0.25 };
}

export function classifyRiwiIntent(message: string): RiwiIntent {
  return assessRiwiIntent(message).intent;
}
