import { z } from "zod";
import { mapDiagramSchema } from "./map-diagram";

/**
 * The Listening domain schema.
 *
 * `listeningPackageSchema` is the CANONICAL Listening content shape and the
 * single authority for Listening semantics: question numbering, section
 * membership, evidence bounds, paired answers, clip ranges and asset paths. The
 * canonical import framework (`src/lib/import/listening`) reuses these exact
 * leaf schemas and this exact semantic pass — there is no second Listening
 * schema to drift from this one.
 *
 * Levels of meaning:
 *   • a leaf schema  = the field's own shape
 *   • `listeningPackageSchema` = structure + `listeningDomainIssues` (semantics)
 *   • the import envelope = identity, provenance, publication, assets
 */

const text = z.string().trim().min(1).max(12000);

export const listeningClipSchema = z.object({
  q: z.number().int().min(1).max(200),
  part: z.number().int().min(1).max(4).optional(),
  sourceQuestion: z.number().int().min(1).max(40).optional(),
  at: z.number().nonnegative(),
  end: z.number().positive(),
  heard: text,
  link: text,
});
export type ListeningClip = z.infer<typeof listeningClipSchema>;

export const listeningQuizSchema = z
  .object({
    q: text,
    options: z.array(text).min(2).max(8),
    correct: z.number().int().nonnegative(),
  })
  .refine((v) => v.correct < v.options.length, "Invalid quiz key");

/**
 * THE CANONICAL ACTIVITY IDS A SOURCE MAY DECLARE — declared once, here, because this is the
 * contract a SOURCE PACKAGE signs when it says what its own material supports.
 *
 * Two rules this constant exists to keep:
 *   • the count is NOT fixed. The old `max(9)` hard-coded the number of activities one particular
 *     owner test happened to have; the bound is now the size of this list, so adding a genuinely
 *     new activity type raises the ceiling with it and no test is ever squeezed into a shape it
 *     does not have.
 *   • `map` is a first-class activity, not a flavour of MCQ. A map/plan question is answered by
 *     choosing a letter from a plan, and the owner's rule is that Q11–14 of a map test are
 *     Map / Plan — so the SOURCE can say so and the registry can offer Map / Plan Mastery.
 */
export const LISTENING_ACTIVITY_IDS = [
  "exam",
  "review",
  "script",
  "mcq",
  "recall",
  "vocab",
  "matching",
  "completion",
  "map",
  "retry",
] as const;
export type ListeningSourceActivityId = (typeof LISTENING_ACTIVITY_IDS)[number];

export const listeningStudyPackSchema = z.object({
  kind: z.literal("research-practice"),
  activities: z.array(z.enum(LISTENING_ACTIVITY_IDS)).min(1).max(LISTENING_ACTIVITY_IDS.length).optional(),
  partRanges: z.record(z.tuple([z.number().nonnegative(), z.number().positive()])),
  scriptParts: z.array(z.object({part:z.number().int().min(1).max(4),transcript:text,gaps:z.array(z.object({q:z.number().int().min(1).max(200),match:text,answer:text})).max(200)})).max(4).optional(),
  recall: z.array(z.object({ part: z.number().int().min(1).max(4), title: text, points: z.array(text).min(1).max(20) })).max(4).default([]),
});
export type ListeningStudyPack = z.infer<typeof listeningStudyPackSchema>;

export const listeningSectionSchema = z.object({
  number: z.number().int().min(1).max(4),
  title: text,
  transcript: z.string().max(100000).default(""),
  reviewRequired: z.boolean().default(false),
});
export type ListeningSection = z.infer<typeof listeningSectionSchema>;

export const listeningQuestionSchema = z.object({
  number: z.number().int().min(1).max(40),
  section: z.number().int().min(1).max(4),
  text,
  instruction: z.string().max(2000),
  /**
   * The question's SHAPE, as the source authored it. `map` is its own kind: a map/plan question
   * carries a shared A–I label pool and is graded as a label, so filing it as `mcq` would both
   * mis-grade it and hand it to the wrong mastery activity.
   */
  kind: z.enum(["completion", "mcq", "matching", "map"]).optional(),
  /**
   * THE SOURCE'S OWN CANONICAL QUESTION TYPE, when it names one.
   *
   * `kind` is a coarse shape (completion / mcq / matching / map). It cannot say whether a
   * completion item is a form, note, table, flow-chart, summary or sentence completion, nor
   * whether a drawing is a map or a plan — and the registry distinguishes all of those, because
   * they carry different review and evidence expectations. Without this field the import layer had
   * to guess from `options.length`, which is how a completion question with a word bank became
   * "multiple choice" and a map became an MCQ.
   *
   * Additive and optional: a payload written before this field existed keeps parsing, and a source
   * that states only the coarse kind is still imported — reported for review rather than guessed
   * at (see `question-identity.ts`).
   */
  typeCode: z.string().trim().min(3).max(40).optional(),
  options: z.array(z.string().max(2000)).max(12),
  key: text,
  alternatives: z.array(z.string().max(500)).max(20),
  pair: z.array(z.number().int().min(1).max(40)).max(2),
  evidence: z.object({ at: z.number().nonnegative(), end: z.number().positive().optional(), why: z.string().max(12000) }),
});
export type ListeningQuestion = z.infer<typeof listeningQuestionSchema>;

export const listeningKeyword2RowSchema = listeningClipSchema
  .extend({
    options: z.array(text).min(2).max(8),
    correct: z.number().int().nonnegative(),
  })
  .or(listeningClipSchema.extend({ answer: text }));
export type ListeningKeyword2Row = z.infer<typeof listeningKeyword2RowSchema>;

export const listeningVocabularyEntrySchema = z.object({
  word: z.string().min(1).max(120),
  pos: z.string().max(30),
  uz: z.string().max(500),
  def: z.string().min(1).max(500),
  ex: z.string().max(500),
  also: z.array(z.string().max(120)).max(20),
  quiz: listeningQuizSchema.optional(),
});
export type ListeningVocabularyEntry = z.infer<typeof listeningVocabularyEntrySchema>;

export const listeningAuthoredRuntimeSchema = z.object({
  entryPath: z.string().max(200),
  files: z.record(z.string().max(5 * 1024 * 1024)),
});
export type ListeningAuthoredRuntime = z.infer<typeof listeningAuthoredRuntimeSchema>;

/** Structural view the semantic pass needs; both schemas below satisfy it. */
export type ListeningDomainCheck = {
  audio: { path?: string | undefined; durationSec: number };
  imagePath?: string | null | undefined;
  sections: ListeningSection[];
  questions: ListeningQuestion[];
  keyword1: ListeningClip[];
  keyword2: ListeningKeyword2Row[];
  studyPack?: ListeningStudyPack | undefined;
  authoredRuntime?: ListeningAuthoredRuntime | undefined;
};

/**
 * Level-2 Listening semantics. Shared verbatim by the stored package schema and
 * the canonical import package, so an import that would be rejected by the
 * runtime cannot pass the importer either.
 */
export function listeningDomainIssues(v: ListeningDomainCheck, ctx: z.RefinementCtx) {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!v.questions.length && !v.authoredRuntime) fail("Missing questions");
  if (v.authoredRuntime && (!safePackagePath(v.authoredRuntime.entryPath) || !v.authoredRuntime.files[v.authoredRuntime.entryPath] || Object.keys(v.authoredRuntime.files).some(path => !safePackagePath(path) || !/\.(html?|css|js)$/i.test(path)) || JSON.stringify(v.authoredRuntime.files).length > 6 * 1024 * 1024)) fail("Invalid authored runtime");
  if (v.studyPack) {
    if (new Set(v.studyPack.recall.map(row => row.part)).size !== v.studyPack.recall.length) fail("Duplicate recall Part");
    for (const [part, range] of Object.entries(v.studyPack.partRanges))
      if (!v.sections.some(section => String(section.number) === part) || range[1] <= range[0] || range[1] > v.audio.durationSec + 1) fail("Part range outside audio");
    for (const row of v.studyPack.recall)
      if (!v.studyPack.partRanges[String(row.part)]) fail("Recall Part has no audio range");
  }
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
}

export const listeningPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** Owner runtime is JSON data only; execution is restricted by authored-sandbox.ts. */
    authoredRuntime: listeningAuthoredRuntimeSchema.optional(),
    /**
     * Explicit legacy marker. Never inferred from a title or a filename: a new
     * canonical import leaves it unset, a converted/retained legacy runtime sets
     * it to true so the library and the migration report can count it.
     */
    legacyRuntime: z.boolean().optional(),
    studyPack: listeningStudyPackSchema.optional(),
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
    sections: z.array(listeningSectionSchema).min(1).max(4),
    questions: z.array(listeningQuestionSchema).min(0).max(40),
    keyword1: z.array(listeningClipSchema.extend({ text })).min(0).max(200),
    keyword2: z.array(listeningKeyword2RowSchema).min(0).max(40),
    vocabulary: z.array(listeningVocabularyEntrySchema).min(0).max(40),
  })
  .superRefine(listeningDomainIssues);
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
