import { eq } from "drizzle-orm";
import { z } from "zod";
import type { db } from "@/db/client";
import { generalReadingPassages, generalReadingSets, readingPassages, readingQuestions } from "@/db/schema";
import { ingestReadingPassageOccurrences } from "@/lib/services/lexical/reading-occurrences";

/**
 * General Reading content bundle (authored by a teacher/owner — never generated here).
 * One set = up to three passages, each with optional questions and an authored
 * vocabulary list that becomes canonical senses + occurrences through the shared
 * ingestion rule (exact sense only inside the author's example sentence).
 */
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

type Tx = Pick<typeof db, "select" | "insert" | "update" | "query" | "delete">;

/** Idempotent on sourceRef: a re-run reports the existing set and writes nothing. */
export async function importGeneralReadingSet(tx: Tx, input: GeneralReadingBundle) {
  const bundle = generalReadingBundle.parse(input);
  const existing = await tx.query.generalReadingSets.findFirst({ where: eq(generalReadingSets.sourceRef, bundle.sourceRef) });
  if (existing) return { setId: existing.id, created: false, passages: [] as { passageNo: number; passageId: string; resolved: number; unresolved: number }[] };
  const state = bundle.publish ? "published" as const : "draft" as const;
  const [set] = await tx.insert(generalReadingSets).values({ title: bundle.title, description: bundle.description ?? null, difficultyLevel: bundle.level ?? null, publicationState: state, sourceRef: bundle.sourceRef }).returning();
  const passages = [];
  for (const item of [...bundle.passages].sort((a, b) => a.passageNo - b.passageNo)) {
    const [passage] = await tx.insert(readingPassages).values({ title: item.title, bodyText: item.body, publicationState: state, sourceRef: bundle.sourceRef.slice(0, 80) }).returning();
    await tx.insert(generalReadingPassages).values({ passageId: passage!.id, setId: set!.id, passageNo: item.passageNo });
    if (item.questions.length) {
      await tx.insert(readingQuestions).values(item.questions.map((q, index) => {
        const at = q.evidence ? item.body.indexOf(q.evidence) : -1;
        return {
          passageId: passage!.id, order: index + 1, questionNo: q.questionNo, type: q.type, questionText: q.text,
          options: q.options ?? null, correctAnswer: q.answer, acceptedAnswers: q.accepted, explanation: q.explanation,
          evidenceQuote: q.evidence ?? null, evidenceStartChar: at >= 0 ? at : null, evidenceEndChar: at >= 0 ? at + q.evidence!.length : null,
          evidenceType: q.evidence ? (at >= 0 ? "source_marker" : "missing_source") : null,
        };
      }));
    }
    // Question evidence is NOT an input here: occurrences come only from the vocabulary list.
    const lexical = await ingestReadingPassageOccurrences(tx, passage!.id, item.body, item.vocabulary);
    passages.push({ passageNo: item.passageNo, passageId: passage!.id, resolved: lexical.resolved, unresolved: lexical.unresolved });
  }
  return { setId: set!.id, created: true, passages };
}
