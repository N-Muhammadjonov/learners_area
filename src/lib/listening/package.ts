import { z } from "zod";

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
    sections: z
      .array(
        z.object({
          number: z.number().int().min(1).max(4),
          title: text,
          transcript: z.string().max(100000),
          reviewRequired: z.boolean().default(false),
        }),
      )
      .length(4),
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
          evidence: z.object({ at: z.number().nonnegative(), why: text }),
        }),
      )
      .length(40),
    keyword1: z.array(clip.extend({ text })).min(1).max(40),
    keyword2: z
      .array(
        clip.extend({
          options: z.array(text).min(2).max(8),
          correct: z.number().int().nonnegative(),
        }),
      )
      .min(1)
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
          quiz,
        }),
      )
      .min(1)
      .max(40),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (new Set(v.sections.map((s) => s.number)).size !== 4)
      fail("Duplicate section");
    if (new Set(v.questions.map((q) => q.number)).size !== 40)
      fail("Questions must be Q1–Q40 exactly once");
    for (const q of v.questions) {
      if (q.section !== Math.ceil(q.number / 10))
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
      if (row.correct >= row.options.length) fail("Invalid Keyword II key");
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
export function publicationIssues(p: ListeningPackage) {
  return p.sections.flatMap((s) =>
    !s.transcript.trim()
      ? [`Section ${s.number}: full transcript missing`]
      : s.reviewRequired
        ? [`Section ${s.number}: transcript requires audio review`]
        : [],
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
