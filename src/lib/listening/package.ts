import { z } from "zod";
import { mapDiagramSchema } from "./map-diagram";

const text = z.string().trim().min(1).max(12000);
const clip = z.object({
  q: z.number().int().min(1).max(40),
  at: z.number().nonnegative(),
  end: z.number().positive(),
  heard: text,
  link: text,
});
const quiz = z
  .object({
    q: text,
    options: z.array(text).min(2).max(8),
    correct: z.number().int().nonnegative(),
  })
  .refine((v) => v.correct < v.options.length, "Invalid quiz key");
export const listeningPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    collection: z.enum(["essential", "academic", "general", "question_types", "mcq"]).optional(),
    testId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    title: z.string().trim().min(1).max(200),
    category: z.literal("full"),
    provenance: text,
    audio: z.object({
      path: z.string().max(200),
      durationSec: z.number().min(60).max(7200),
    }),
    imagePath: z.string().max(200).nullable(),
    mapDiagram: mapDiagramSchema.optional(),
    sections: z
      .array(
        z.object({
          number: z.number().int().min(1).max(4),
          title: text,
          transcript: z.string().max(100000).default(""),
          reviewRequired: z.boolean().default(false),
        }),
      )
      .min(1).max(4),
    questions: z
      .array(
        z.object({
          number: z.number().int().min(1).max(40),
          section: z.number().int().min(1).max(4),
          text,
          instruction: z.string().max(2000),
          options: z.array(z.string().max(2000)).max(12),
          key: text,
          alternatives: z.array(z.string().max(500)).max(20),
          pair: z.array(z.number().int().min(1).max(40)).max(2),
          evidence: z.object({ at: z.number().nonnegative(), why: z.string().max(12000) }),
        }),
      )
      .min(1).max(40),
    keyword1: z.array(clip.extend({ text })).min(0).max(40),
    keyword2: z
      .array(
        clip.extend({
          options: z.array(text).min(2).max(8),
          correct: z.number().int().nonnegative(),
        }).or(clip.extend({ answer: text })),
      )
      .min(0)
      .max(40),
    vocabulary: z
      .array(
        z.object({
          word: z.string().min(1).max(120),
          pos: z.string().max(30),
          uz: z.string().max(500),
          def: z.string().min(1).max(500),
          ex: z.string().max(500),
          also: z.array(z.string().max(120)).max(20),
          quiz: quiz.optional(),
        }),
      )
      .min(0)
      .max(40),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(v.sections.map((s) => s.number)).size !== v.sections.length)
      fail("Duplicate section");
    if (new Set(v.questions.map((q) => q.number)).size !== v.questions.length)
      fail("Duplicate question number");
    for (const q of v.questions) {
      if (!v.sections.some((section) => section.number === q.section))
        fail(`Q${q.number}: wrong section`);
      if (q.evidence.at >= v.audio.durationSec)
        fail(`Q${q.number}: evidence outside audio`);
      for (const n of q.pair)
        if (
          n === q.number ||
          !v.questions.some((x) => x.number === n && x.pair.includes(q.number))
        )
          fail("Invalid answer pair");
    }
    for (const rows of [v.keyword1, v.keyword2]) {
      if (new Set(rows.map((x) => x.q)).size !== rows.length)
        fail("Duplicate keyword question");
      for (const row of rows)
        if (row.end <= row.at || row.end > v.audio.durationSec)
          fail("Clip outside audio");
    }
    for (const row of v.keyword2)
      if ("correct" in row && row.correct >= row.options.length) fail("Invalid Keyword II key");
    for (const path of [v.audio.path, v.imagePath].filter(Boolean) as string[])
      if (!safePackagePath(path)) fail("Unsafe asset path");
  });
export type ListeningPackage = z.infer<typeof listeningPackageSchema>;
export const ACTIVITY_NAMES = [
  "Full Exam",
  "Review & Revision",
  "Keyword Match I",
  "Keyword Match II",
  "Vocabulary Session",
] as const;

/**
 * Paths are only ever used as lookup keys (nothing is written to disk under
 * them), so ordinary human filenames — parentheses, apostrophes, Uzbek or
 * Cyrillic letters — are accepted. What stays refused: control characters,
 * backslashes, drive letters, absolute paths and traversal.
 */
export function safePackagePath(path: string) {
  return (
    path.length > 0 &&
    path.length <= 400 &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f\\:*?"<>|]/.test(path) &&
    !path.startsWith("/") &&
    !path.split("/").includes("..") &&
    !path.includes("//")
  );
}
export type PublicationBlocker = { kind: "transcript_missing" | "transcript_review"; section: number };
/** Author reviews the interactive preview; transcript completeness never blocks publication. */
export function publicationBlockers(_p: ListeningPackage): PublicationBlocker[] {
  return [];
}
/** Technical (English) form for API payloads and logs only. */
export function publicationIssues(p: ListeningPackage) {
  return publicationBlockers(p).map((b) =>
    b.kind === "transcript_missing"
      ? `Section ${b.section}: full transcript missing`
      : `Section ${b.section}: transcript requires audio review`,
  );
}
export function normalized(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
/** Paired choose-TWO answers may swap positions, but the same letter cannot earn both marks. */
export function gradePackage(
  p: ListeningPackage,
  values: Record<number, string>,
) {
  return p.questions.map((q) => {
    const answer = normalized(values[q.number] ?? "");
    const keys = [
      q.key,
      ...q.alternatives,
      ...q.pair.map((n) => p.questions.find((x) => x.number === n)!.key),
    ].map(normalized);
    const duplicate = q.pair.some(
      (n) => n < q.number && normalized(values[n] ?? "") === answer,
    );
    return {
      number: q.number,
      correct: !!answer && keys.includes(answer) && !duplicate,
    };
  });
}
