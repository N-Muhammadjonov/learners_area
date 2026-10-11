import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getAssessmentContractOrThrow } from "@/lib/services/coach/contracts/registry";
import type { DictionaryLookup } from "./dictionary";

export const dictionaryTaskSchema = z.enum(["vocabulary.meaning", "vocabulary.translation"]);
export type DictionaryTask = z.infer<typeof dictionaryTaskSchema>;
const UUID = z.string().uuid();
export const dictionaryOccurrenceEvidenceSchema = z.object({
  occurrenceId: UUID, lexemeId: UUID, sourceTitle: z.string().max(240), surfaceForm: z.string().max(120), sentenceText: z.string().max(600),
  sourceType: z.enum(["reading", "listening", "video"]).optional(), videoLessonId: UUID.nullable().optional(),
  attemptId: UUID.nullable().optional(), passageId: UUID.nullable().optional(),
  readingMode: z.enum(["academic", "general_practice"]).optional(), generalSetId: UUID.nullable().optional(), passageNo: z.number().int().nullable().optional(),
  listeningTestId: UUID.nullable().optional(), sectionNumber: z.number().int().nullable().optional(),
  startMs: z.number().int().nullable().optional(), endMs: z.number().int().nullable().optional(),
}).strict();
const dictionaryEvidenceSchema = z.object({
  status: z.literal("resolved"), canonicalLexemeId: UUID, senseId: UUID, term: z.string().min(1).max(120), definitionEn: z.string().trim().min(1).max(4000),
  translationUz: z.string().max(2000).nullable(), partOfSpeech: z.string().max(80).nullable(), lexicalType: z.string().max(24).nullable(),
  example: z.string().max(2000).nullable(), collocations: z.string().max(2000).nullable(),
  source: z.string().max(240), verified: z.boolean(), pronunciation: z.string().max(200).nullable(), occurrence: dictionaryOccurrenceEvidenceSchema.nullable(),
}).strict();
const stageSchema = z.object({
  kind: z.enum(["canonical_sense", "simple_meaning", "contextual_translation", "example"]),
  status: z.enum(["provided", "missing"]), text: z.string().min(1).max(4200),
}).strict();
export const dictionaryTeachingSchema = z.object({
  task: dictionaryTaskSchema, promptVersion: z.string().min(1).max(80), rubricVersion: z.string().min(1).max(80),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), senseId: z.string().uuid(),
  evidenceComplete: z.boolean(), verified: z.boolean(), stages: z.array(stageSchema).length(3),
}).strict().superRefine((value, ctx) => {
  const expected = ["canonical_sense", value.task === "vocabulary.meaning" ? "simple_meaning" : "contextual_translation", "example"];
  if (value.stages.some((stage, i) => stage.kind !== expected[i])
    || value.evidenceComplete !== (value.verified && value.stages.every(stage => stage.status === "provided")))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dictionary_teaching_evidence_mismatch" });
});
export const dictionaryResolvedAnswerSchema = dictionaryEvidenceSchema.extend({
  answer: z.string().min(1).max(6000), uncertainty: z.string().max(500).nullable(), teaching: dictionaryTeachingSchema,
}).strict();

/** Select a finite teaching format; learner text supplies neither lexical
 * authority nor a contract version. Contextual-sense elimination is separate. */
export function selectDictionaryTask(message: string): DictionaryTask {
  return /\b(?:translate|translation)\b|tarjim|переведи|перевод/iu.test(message)
    ? "vocabulary.translation" : "vocabulary.meaning";
}

/** Only authored facts are rendered. A missing example or translation remains
 * a visible missing stage; no provider or same-spelling sibling fills it in. */
export function teachDictionaryEntry(input: Extract<DictionaryLookup, { status: "resolved" }>, task: DictionaryTask, language: "en" | "uz") {
  const entry = dictionaryEvidenceSchema.parse(input);
  dictionaryTaskSchema.parse(task);
  if (entry.canonicalLexemeId !== entry.senseId || (entry.occurrence && entry.occurrence.lexemeId !== entry.senseId)) throw new Error("dictionary_sense_evidence_invalid");
  const uz = language === "uz", contract = getAssessmentContractOrThrow(task);
  const absentExample = uz ? "Bu ma'no uchun manbada misol yo'q." : "No source example is available for this sense.";
  const absentTranslation = uz ? "Bu ma'no uchun tasdiqlangan manba tarjimasi yo'q." : "No source translation is available for this sense.";
  const canonicalSense = `${entry.term}${entry.partOfSpeech ? ` (${entry.partOfSpeech})` : ""}`;
  const example = entry.example?.trim() ? entry.example : null;
  const translation = entry.translationUz?.trim() ? entry.translationUz : null;
  const stages = [
    { kind: "canonical_sense" as const, status: "provided" as const, text: canonicalSense },
    task === "vocabulary.meaning"
      ? { kind: "simple_meaning" as const, status: "provided" as const, text: entry.definitionEn }
      : { kind: "contextual_translation" as const, status: translation ? "provided" as const : "missing" as const,
        text: translation ? `${entry.occurrence?.surfaceForm ?? entry.term}: ${translation}` : absentTranslation },
    { kind: "example" as const, status: example ? "provided" as const : "missing" as const, text: example ?? absentExample },
  ];
  const teaching = dictionaryTeachingSchema.parse({ task, promptVersion: contract.version, rubricVersion: contract.rubricVersion,
    senseId: entry.senseId, verified: entry.verified, evidenceComplete: entry.verified && stages.every(stage => stage.status === "provided"),
    stages, sourceHash: createHash("sha256").update(JSON.stringify({ entry, task, promptVersion: contract.version,
      rubricVersion: contract.rubricVersion })).digest("hex") });
  const labels = uz ? { canonical_sense: "Lug'atdagi ma'no", simple_meaning: "Sodda ma'no", contextual_translation: "Shu ma'noning tarjimasi", example: "Manba misoli" }
    : { canonical_sense: "Canonical sense", simple_meaning: "Plain meaning", contextual_translation: "Translation of this sense", example: "Source example" };
  // Preserve full stage evidence in the internal DTO. The visible response has
  // the existing 6000-character contract and explicitly labels long excerpts.
  const display = (text: string, limit: number) => text.length <= limit ? text
    : text.slice(0, limit) + (uz ? " [manba parchasi qisqartirildi]" : " [source excerpt shortened]");
  const lines = stages.map(stage => `${labels[stage.kind]}: ${display(stage.text, stage.kind === "canonical_sense" ? 220 : 1500)}`);
  if (task === "vocabulary.meaning" && translation) lines.push(`Uzbek: ${display(translation, 600)}`);
  if (task === "vocabulary.translation") {
    lines.push(`${uz ? "Ma'no chegarasi" : "Sense boundary"}: ${display(entry.definitionEn, 800)}`);
    lines.push(uz ? "Bu bitta ma'noning lug'at tarjimasi; butun gapning tarjimasi emas."
      : "This is the dictionary translation of one sense; it is not a translation of the whole sentence.");
  }
  if (entry.collocations?.trim()) lines.push(`Collocations: ${display(entry.collocations, 400)}`);
  if (entry.occurrence) lines.push(`${uz ? "Manba gap" : "Source context"}: ${display(entry.occurrence.sentenceText, 600)}`);
  const missing = !example || (task === "vocabulary.translation" && !translation);
  const uncertainty = [!entry.verified ? (uz ? "Bu lug'at yozuvi hali tekshirilmagan; uni yakuniy manba sifatida qabul qilmang."
    : "This catalogue entry has not been verified; do not treat it as authoritative.") : null,
    missing ? (uz ? "Manba dalili yetishmaydi: tushuntirish to'liq emas."
      : "Source evidence is missing: this explanation is incomplete.") : null].filter(Boolean).join(" ") || null;
  return { teaching, answer: lines.join("\n\n"), uncertainty };
}
