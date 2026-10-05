import { z } from "zod";

/** Fixed outbound task DTOs; arbitrary application objects are never accepted. */
const boundedText = (max: number) => z.string().max(max);
const writingCheck = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("translation"), uzbekSource: boundedText(600), referenceEnglish: boundedText(600), acceptedAlternatives: z.array(boundedText(600)).max(10), targetBand: z.number().int().min(5).max(9), answer: boundedText(600) }).strict(),
  z.object({ kind: z.literal("activation"), item: boundedText(300), meaningHint: boundedText(500).nullable(), mode: z.enum(["writing", "speaking"]), targetLevel: boundedText(20), uzbekPrompt: boundedText(600).nullable(), upgradeFrom: boundedText(500).nullable(), answer: boundedText(2000) }).strict(),
  z.object({ kind: z.literal("pattern"), pattern: boundedText(240), sourceExample: boundedText(400), sourceTopic: boundedText(120), newTopic: boundedText(120), answer: boundedText(2000) }).strict(),
]);

const taskSchemas = {
  writing: z.object({ taskType: z.enum(["task1", "task2"]), prompt: boundedText(4000), content: boundedText(20_000), targetWordCount: z.number().int().min(1).max(1000), detailedAnalysis: z.boolean().optional(), wordCount: z.number().int().min(0).max(10_000).optional(), check: writingCheck.optional() }).strict(),
  writing_check: writingCheck,
  speaking: z.object({ part: z.enum(["part1", "part2", "part3", "general", "mock"]), promptText: boundedText(2000).nullable(), transcript: boundedText(20_000).nullable(), transcriptOrigin: z.enum(["stt", "manual", "browser_stt"]).nullable(), durationMs: z.number().int().min(0).max(3_600_000).nullable(), pronunciationAvailable: z.boolean() }).strict(),
  grammar: z.object({ promptText: boundedText(4000), studentAnswer: boundedText(10_000), targetStructure: boundedText(120).nullable(), sampleAnswer: boundedText(4000).nullable() }).strict(),
  vocabulary: z.object({ targetWord: boundedText(160), definition: boundedText(1000), studentSentence: boundedText(5000) }).strict(),
  assignment: z.object({ title: boundedText(300), description: boundedText(3000).nullable(), studentResponse: boundedText(20_000) }).strict(),
  chat: z.object({ language: z.enum(["uz", "en"]), message: boundedText(4000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: boundedText(2000) }).strict()).max(6), knowledge: z.array(z.object({ ref: z.string().regex(/^K[1-5]$/), text: boundedText(1800), authority: z.number().int().min(0).max(100), version: z.number().int().min(1).nullable() }).strict()).max(5) }).strict(),
} as const;

export type ExternalTask = keyof typeof taskSchemas;
export type ExternalPayload<T extends ExternalTask = ExternalTask> = z.infer<(typeof taskSchemas)[T]>;

const PII_PATTERNS: readonly RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\+?\d[\d().\s-]{7,}\d)\b/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /(?<![\p{L}\p{N}])@[A-Z0-9_]{3,32}\b/giu,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi,
  /\b(?:r2|s3):\/\/[^\s"'<>]+/gi,
  /\bBearer\s+[A-Z0-9._~+/-]{12,}\b/gi,
  /\b(?:DATABASE_URL|(?:AWS|R2|CLOUDFLARE)_(?:ACCESS_KEY_ID|ACCOUNT_ID)|[A-Z][A-Z0-9_]*(?:API_?KEY|ACCESS_?KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?))\s*[:=]\s*["']?[^\s,;"']+/gi,
  /\b(?:password|passwd|pwd|session(?:[_-]?token)?|access[_-]?token|refresh[_-]?token|api[_-]?key|secret(?:[_-]?key)?|authorization|role|user_?id|account_?id)\s*[:=]\s*["']?[^\s,;"']+/gi,
  /\b(?:sk-(?:proj-)?[A-Z0-9_-]{12,}|gsk_[A-Z0-9_-]{16,}|xai-[A-Z0-9_-]{12,}|AKIA[A-Z0-9]{16}|AIza[A-Z0-9_-]{30,}|gh[pousr]_[A-Z0-9]{20,})\b/gi,
  /\beyJ[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}\.[A-Z0-9_-]{10,}\b/gi,
];

/** Replaces likely direct identifiers/secrets before any provider boundary. */
export function redactExternalText(input: string, maximum: number): string {
  // Redact before truncation so a PII value crossing the boundary cannot leak a
  // partial identifier that no longer matches the redaction expression.
  let value = input;
  for (const pattern of PII_PATTERNS) value = value.replace(pattern, "[redacted]");
  return value.slice(0, maximum);
}

function redactValue(value: unknown, maximum: number): unknown {
  if (typeof value === "string") return redactExternalText(value, maximum);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, maximum));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, maximum)]));
  return value;
}

export type GuardResult<T = unknown> = { ok: true; payload: T } | { ok: false; code: "invalid_task" | "invalid_payload" };

/** Strict allowlist + redaction. Unknown fields (including user ids/secrets) reject. */
export function guardExternalPayload<T extends ExternalTask>(task: T, input: unknown): GuardResult<ExternalPayload<T>>;
export function guardExternalPayload(task: string, input: unknown): GuardResult;
export function guardExternalPayload(task: string, input: unknown): GuardResult {
  if (!Object.prototype.hasOwnProperty.call(taskSchemas, task)) return { ok: false, code: "invalid_task" };
  const schema = taskSchemas[task as ExternalTask];
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_payload" };
  const data = parsed.data;
  return { ok: true, payload: redactValue(data, task === "chat" ? 4000 : 20_000) };
}

/** Canary check used at adapter and audit serialization boundaries. */
export function hasSensitiveOutboundFields(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const forbidden = /^(email|phone|telegram(id|username)?|account(id)?|user(id)?|database_url|provider(_|-)?key|secret|password|token|r2|ssh)$/i;
  return Object.entries(value).some(([key, item]) => forbidden.test(key) || hasSensitiveOutboundFields(item));
}

export const EXTERNAL_TASKS = Object.keys(taskSchemas) as ExternalTask[];
