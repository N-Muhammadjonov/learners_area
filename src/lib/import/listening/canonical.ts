import { z } from "zod";
import { mapDiagramSchema } from "@/lib/listening/map-diagram";
import {
  listeningClipSchema,
  listeningKeyword2RowSchema,
  listeningPackageSchema,
  listeningQuestionSchema,
  listeningSectionSchema,
  listeningStudyPackSchema,
  listeningVocabularyEntrySchema,
  type ListeningPackage,
} from "@/lib/listening/package";
import { contentEnvelopeSchema, type CanonicalPackage } from "../core/envelope";
import { defineContentType, type AssetRequirement, type ContentTypeDescriptor } from "../core/registry";
import { executableMarkupIssues, issue, issuesFromZodError, type ImportIssue } from "../core/validation";
import { describeProvenance } from "../core/provenance";

/**
 * Listening — canonical package v2.
 *
 * The envelope carries identity, provenance, publication intent and asset
 * declarations; `content` carries the exam itself. Content reuses the exact leaf
 * schemas from `@/lib/listening/package`, and normalizing to the stored package
 * runs the real `listeningPackageSchema.parse(...)`, so the importer and the
 * renderer can never disagree about what a valid Listening test is.
 */

export const LISTENING_CANONICAL_VERSION = 2;
export const LISTENING_CONTENT_TYPE = "full_test";
export const LISTENING_AUDIO_ASSET_KEY = "audio.full";
export const LISTENING_IMAGE_ASSET_KEY = "image.map";

const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "video/webm",
  "audio/flac",
];
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

const assetKey = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,60}$/);

/** `answer`/`type` are accepted as authoring aliases; the canonical names win. */
function normalizeQuestionAliases(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const row = { ...(value as Record<string, unknown>) };
  if (row.key === undefined && row.answer !== undefined) row.key = row.answer;
  if (row.kind === undefined && row.type !== undefined) row.kind = row.type;
  delete row.answer;
  delete row.type;
  if (row.evidence && typeof row.evidence === "object") {
    const evidence = { ...(row.evidence as Record<string, unknown>) };
    if (evidence.at === undefined && evidence.timestamp !== undefined) evidence.at = evidence.timestamp;
    delete evidence.timestamp;
    row.evidence = evidence;
  }
  return row;
}

const canonicalQuestionSchema = z.preprocess(normalizeQuestionAliases, listeningQuestionSchema);

export const listeningCanonicalContentSchema = z
  .object({
    collection: z.enum(["essential", "academic", "general", "question_types", "mcq"]).default("academic"),
    audio: z
      .object({
        durationSec: z.number().min(60).max(7200),
        assetKey: assetKey.default(LISTENING_AUDIO_ASSET_KEY),
        /** Transport hint (archive path). Never an object key, never ownership. */
        path: z.string().max(200).optional(),
      })
      .strict(),
    image: z.object({ assetKey: assetKey.default(LISTENING_IMAGE_ASSET_KEY) }).strict().nullable().optional(),
    imagePath: z.string().max(200).nullable().optional(),
    mapDiagram: mapDiagramSchema.optional(),
    sections: z.array(listeningSectionSchema).min(1).max(4),
    questions: z.array(canonicalQuestionSchema).min(0).max(40),
    keyword1: z.array(listeningClipSchema.extend({ text: z.string().trim().min(1).max(12000) })).min(0).max(200).default([]),
    keyword2: z.array(listeningKeyword2RowSchema).min(0).max(40).default([]),
    vocabulary: z.array(listeningVocabularyEntrySchema).min(0).max(40).default([]),
    studyPack: listeningStudyPackSchema.optional(),
  })
  .strict();
export type ListeningCanonicalContent = z.infer<typeof listeningCanonicalContentSchema>;

export type ListeningCanonicalPackage = CanonicalPackage<ListeningCanonicalContent>;

/** Level-3: what the content points at. Declarations must cover these keys. */
export function listeningAssetRequirements(content: ListeningCanonicalContent): AssetRequirement[] {
  const requirements: AssetRequirement[] = [
    {
      key: content.audio.assetKey,
      role: "audio",
      required: true,
      label: "Full test recording",
      mimeTypes: AUDIO_MIME_TYPES,
      maxBytes: 200 * 1024 * 1024,
      usedBy: "content.audio",
    },
  ];
  if (content.image || content.imagePath)
    requirements.push({
      key: content.image?.assetKey ?? LISTENING_IMAGE_ASSET_KEY,
      role: "image",
      required: true,
      label: "Map / diagram image",
      mimeTypes: IMAGE_MIME_TYPES,
      maxBytes: 20 * 1024 * 1024,
      usedBy: "content.image",
    });
  return requirements;
}

/**
 * Level-2 semantics that the domain schema cannot express on its own: identity
 * shape and authoring consistency. Authoring advice is non-blocking so an older
 * valid package keeps importing.
 */
export function listeningSemanticIssues(pkg: ListeningCanonicalPackage): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(pkg.sourceRef))
    issues.push(
      issue(
        2,
        "semantic_invalid",
        "A Listening sourceRef must be lowercase letters, digits and dashes (it becomes the stable test identity).",
        "sourceRef",
      ),
    );
  if (!pkg.content.questions.length)
    issues.push(issue(2, "semantic_invalid", "A Listening test needs at least one question.", "content.questions"));
  if (pkg.content.sections.length !== 4)
    issues.push(
      issue(2, "semantic_invalid", "A full Listening test normally has 4 parts.", "content.sections", false),
    );
  for (const question of pkg.content.questions) {
    if (question.kind === "mcq" && question.options.length < 2)
      issues.push(
        issue(
          2,
          "semantic_invalid",
          `Q${question.number}: a multiple-choice question needs at least two options.`,
          `content.questions.${question.number}`,
          false,
        ),
      );
    // `matching` legitimately presents a list to choose from (the tryout renders
    // it as a select), so the "options without mcq" advice covers mcq-authored
    // material only.
    if (question.kind && question.kind !== "mcq" && question.kind !== "matching" && question.options.length >= 2)
      issues.push(
        issue(
          2,
          "semantic_invalid",
          `Q${question.number}: options are present but the type is ${question.kind ?? "unset"}; set "type": "mcq" or remove the options.`,
          `content.questions.${question.number}`,
          false,
        ),
      );
  }
  const missingTranscript = pkg.content.sections.filter((section) => !section.transcript.trim());
  for (const section of missingTranscript)
    issues.push(
      issue(2, "semantic_invalid", `Part ${section.number} has no transcript (allowed, shown as missing in preview).`, "content.sections", false),
    );
  return issues;
}

/**
 * Envelope + content → the stored canonical Listening package. The stored shape
 * is unchanged (schemaVersion 1, `listening_packages.payload`), so every existing
 * renderer, activity and attempt path keeps working without a rewrite.
 */
export function normalizeListeningPackage(pkg: ListeningCanonicalPackage): ListeningPackage {
  const content = pkg.content;
  const declaration = pkg.assets.find((asset) => asset.key === content.audio.assetKey);
  const audioPath = content.audio.path ?? declaration?.path ?? content.audio.assetKey;
  const imageDeclaration = content.image ? pkg.assets.find((asset) => asset.key === content.image!.assetKey) : undefined;
  const imagePath = content.imagePath ?? (content.image ? imageDeclaration?.path ?? content.image.assetKey : null);
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    legacyRuntime: false,
    studyPack: content.studyPack,
    collection: content.collection,
    testId: pkg.sourceRef,
    title: pkg.title,
    category: "full",
    provenance: describeProvenance(pkg),
    audio: { path: audioPath, durationSec: content.audio.durationSec },
    imagePath,
    mapDiagram: content.mapDiagram,
    sections: content.sections,
    questions: content.questions,
    keyword1: content.keyword1,
    keyword2: content.keyword2,
    vocabulary: content.vocabulary,
  });
}

/**
 * Validate an already-built canonical object (converter, script or migration
 * tooling) with exactly the rules an uploaded package faces, and return both the
 * canonical package and the stored payload.
 */
export function validateCanonicalListeningPackage(
  raw: unknown,
):
  | { ok: true; pkg: ListeningCanonicalPackage; stored: ListeningPackage }
  | { ok: false; issues: ImportIssue[] } {
  const envelope = contentEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return { ok: false, issues: issuesFromZodError(envelope.error, 1) };
  const content = listeningCanonicalContentSchema.safeParse(envelope.data.content);
  if (!content.success) return { ok: false, issues: issuesFromZodError(content.error, 1) };
  const pkg = { ...envelope.data, content: content.data } as ListeningCanonicalPackage;
  const issues = [
    ...listeningSemanticIssues(pkg),
    ...executableMarkupIssues(pkg.content, "content"),
  ].filter((entry) => entry.blocking);
  if (issues.length) return { ok: false, issues };
  return { ok: true, pkg, stored: normalizeListeningPackage(pkg) };
}

export function listeningPreview(pkg: ListeningCanonicalPackage) {
  const content = pkg.content;
  const kinds = content.questions.reduce<Record<string, number>>((acc, question) => {
    const kind = question.kind ?? (question.options.length >= 2 ? "mcq" : "completion");
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});
  const transcripts = content.sections.filter((section) => section.transcript.trim()).length;
  const withEvidence = content.questions.filter((question) => question.evidence.at > 0).length;
  return {
    title: pkg.title,
    lines: [
      { label: "Source identity", value: pkg.sourceRef },
      { label: "Collection", value: content.collection },
      { label: "Parts", value: String(content.sections.length) },
      { label: "Questions", value: String(content.questions.length) },
      {
        label: "Question types",
        value: Object.entries(kinds)
          .map(([kind, count]) => `${kind}: ${count}`)
          .join(" · ") || "none",
      },
      { label: "Transcripts", value: `${transcripts}/${content.sections.length} parts` },
      { label: "Evidence timestamps", value: `${withEvidence}/${content.questions.length} questions` },
      { label: "Recording", value: `${Math.round(content.audio.durationSec / 60)} min` },
      { label: "Vocabulary", value: String(content.vocabulary.length) },
      {
        label: "Activities",
        value: content.studyPack?.activities?.join(", ") ?? "standard set",
      },
      { label: "Publication intent", value: pkg.publication.state },
      { label: "Provenance", value: describeProvenance(pkg) },
    ],
    warnings: [
      ...(content.image ? ["A map/diagram image is required by this package."] : []),
      ...(content.sections.some((section) => !section.transcript.trim()) ? ["Some parts have no transcript."] : []),
    ],
  };
}

/** A deliberately tiny but VALID package: the shape, not a sample exam. */
export function listeningTemplate() {
  return {
    schemaVersion: LISTENING_CANONICAL_VERSION,
    module: "listening",
    contentType: LISTENING_CONTENT_TYPE,
    sourceRef: "listening-test-example",
    title: "Listening Test Example",
    language: "en",
    provenance: { source: "ai_authoring", note: "Generated from the Learners Area Listening package spec." },
    publication: { state: "draft" },
    assets: [
      {
        key: LISTENING_AUDIO_ASSET_KEY,
        role: "audio",
        required: true,
        mimeTypes: AUDIO_MIME_TYPES,
        path: "audio/full.mp3",
      },
    ],
    content: {
      collection: "academic",
      audio: { durationSec: 600, assetKey: LISTENING_AUDIO_ASSET_KEY, path: "audio/full.mp3" },
      sections: [
        { number: 1, title: "Part 1", transcript: "Write the full transcript of part 1 here." },
        { number: 2, title: "Part 2", transcript: "" },
        { number: 3, title: "Part 3", transcript: "" },
        { number: 4, title: "Part 4", transcript: "" },
      ],
      questions: [
        {
          number: 1,
          section: 1,
          type: "completion",
          instruction: "Complete the notes. Write ONE WORD ONLY.",
          text: "The booking reference is [1] ………… .",
          options: [],
          answer: "HX492",
          alternatives: ["HX 492"],
          pair: [],
          evidence: { at: 12.5, end: 16, why: "The receptionist reads the reference back." },
        },
        {
          number: 2,
          section: 1,
          type: "mcq",
          instruction: "Choose the correct letter, A, B or C.",
          text: "What time does the tour start?",
          options: ["A 9:00", "B 10:30", "C 11:15"],
          answer: "B 10:30",
          alternatives: ["10:30", "B"],
          pair: [],
          evidence: { at: 42, end: 47, why: "\"The tour leaves at half past ten\"." },
        },
      ],
      keyword1: [],
      keyword2: [],
      vocabulary: [
        {
          word: "reference",
          pos: "noun",
          uz: "ma'lumotnoma raqami",
          def: "A number that identifies a booking.",
          ex: "The booking reference is HX492.",
          also: ["ref"],
        },
      ],
      studyPack: {
        kind: "research-practice",
        activities: ["exam", "review", "vocab"],
        partRanges: { "1": [0, 300], "2": [300, 600] },
        recall: [{ part: 1, title: "Booking", points: ["Reference number", "Tour time"] }],
      },
    },
  };
}

/**
 * The canonical QA sample: 4 parts, 40 questions, mixed types, transcripts,
 * alternatives, evidence timestamps, vocabulary, activities and a map question.
 * Synthetic material only — never real IELTS content.
 */
export function listeningExample() {
  const topics = ["Community Centre", "City Library", "Riverside Museum", "Science Podcast"];
  const sections = topics.map((topic, index) => ({
    number: index + 1,
    title: `Part ${index + 1}: ${topic}`,
    transcript: Array.from({ length: 4 }, (_, line) =>
      `Part ${index + 1} line ${line + 1}: this synthetic transcript exists for QA of the canonical Listening package.`,
    ).join(" "),
  }));
  const questions = Array.from({ length: 40 }, (_, index) => {
    const number = index + 1;
    const section = Math.min(4, Math.floor(index / 10) + 1);
    const at = 30 + index * 40;
    if (number % 10 === 0)
      return {
        number,
        section,
        type: "mcq" as const,
        instruction: "Choose the correct letter, A, B or C.",
        text: `Synthetic QA question ${number}: which option is correct?`,
        options: ["A first option", "B second option", "C third option"],
        answer: "B second option",
        alternatives: ["B", "second option"],
        pair: [],
        evidence: { at, end: at + 6, why: `The speaker names the second option for question ${number}.` },
      };
    if (number % 10 === 5)
      return {
        number,
        section,
        type: "matching" as const,
        instruction: "Choose the correct letter, A–D.",
        text: `Synthetic QA question ${number}: which service does the speaker describe?`,
        options: ["A Service one", "B Service two", "C Service three", "D Service four"],
        answer: "C Service three",
        alternatives: ["C"],
        pair: [],
        evidence: { at, end: at + 5, why: `The speaker describes service three for question ${number}.` },
      };
    return {
      number,
      section,
      type: "completion" as const,
      instruction: "Complete the notes. Write ONE WORD AND/OR A NUMBER.",
      text: `Synthetic QA note ${number}: the value is [${number}] ………… .`,
      options: [],
      answer: `answer${number}`,
      alternatives: [`answer ${number}`],
      pair: [],
      evidence: { at, end: at + 5, why: `The speaker states answer${number}.` },
    };
  });
  return {
    schemaVersion: LISTENING_CANONICAL_VERSION,
    module: "listening",
    contentType: LISTENING_CONTENT_TYPE,
    sourceRef: "listening-qa-sample-v2",
    title: "Listening QA Sample (synthetic)",
    language: "en",
    provenance: {
      source: "owner_authored",
      note: "Synthetic QA fixture generated from the canonical Listening specification.",
    },
    publication: { state: "draft" },
    assets: [
      {
        key: LISTENING_AUDIO_ASSET_KEY,
        role: "audio",
        required: true,
        mimeTypes: AUDIO_MIME_TYPES,
        path: "audio/full.mp3",
      },
      {
        key: LISTENING_IMAGE_ASSET_KEY,
        role: "image",
        required: true,
        mimeTypes: IMAGE_MIME_TYPES,
        path: "images/map.webp",
      },
    ],
    content: {
      collection: "academic",
      audio: { durationSec: 1800, assetKey: LISTENING_AUDIO_ASSET_KEY, path: "audio/full.mp3" },
      image: { assetKey: LISTENING_IMAGE_ASSET_KEY },
      sections,
      questions,
      keyword1: [],
      keyword2: [],
      vocabulary: Array.from({ length: 8 }, (_, index) => ({
        word: `qa-word-${index + 1}`,
        pos: "noun",
        uz: "QA so'z",
        def: `Synthetic QA vocabulary item ${index + 1}.`,
        ex: `The synthetic transcript uses qa-word-${index + 1} once.`,
        also: [],
      })),
      studyPack: {
        kind: "research-practice",
        activities: ["exam", "review", "script", "mcq", "recall", "vocab", "matching", "completion"],
        partRanges: { "1": [0, 450], "2": [450, 900], "3": [900, 1350], "4": [1350, 1800] },
        recall: topics.map((topic, index) => ({
          part: index + 1,
          title: topic,
          points: [`${topic} detail one`, `${topic} detail two`],
        })),
      },
    },
  };
}

export const listeningPackageDescriptor = defineContentType({
  module: "listening",
  contentType: LISTENING_CONTENT_TYPE,
  schemaVersion: LISTENING_CANONICAL_VERSION,
  label: "Listening full test",
  status: "active",
  contentSchema: listeningCanonicalContentSchema,
  migratableVersions: [1],
  upgrade: upgradeListeningPackage,
  semanticIssues: listeningSemanticIssues,
  requiredAssets: listeningAssetRequirements,
  preview: listeningPreview,
  template: listeningTemplate,
  example: listeningExample,
} satisfies ContentTypeDescriptor<ListeningCanonicalContent>);

/**
 * Version 1 → version 2. Version 1 is the payload that Learners Area already
 * stores and that existing ZIP packages carry (`data/package.json`), so it keeps
 * importing: its identity fields move into the envelope and its assets become
 * declarations. A version-1 payload that carries an `authoredRuntime` is legacy
 * executable material and is refused here — it belongs to the legacy conversion
 * pipeline, never to the canonical importer.
 */
export function upgradeListeningPackage(fromVersion: number, raw: unknown): unknown {
  if (fromVersion !== 1) throw new Error(`Unsupported Listening package version: ${fromVersion}`);
  const parsed = listeningPackageSchema.parse(raw);
  if (parsed.authoredRuntime)
    throw new Error("Legacy authored runtime is not a canonical package: convert it first.");
  const imageKey = parsed.imagePath ? LISTENING_IMAGE_ASSET_KEY : null;
  return {
    schemaVersion: LISTENING_CANONICAL_VERSION,
    module: "listening",
    contentType: LISTENING_CONTENT_TYPE,
    sourceRef: parsed.testId,
    title: parsed.title,
    language: "en",
    provenance: { source: "legacy_conversion", note: parsed.provenance || "Upgraded from a version 1 Listening payload." },
    publication: { state: "draft" },
    assets: [
      {
        key: LISTENING_AUDIO_ASSET_KEY,
        role: "audio",
        required: true,
        mimeTypes: AUDIO_MIME_TYPES,
        ...(parsed.audio.path ? { path: parsed.audio.path } : {}),
      },
      ...(parsed.imagePath
        ? [
            {
              key: LISTENING_IMAGE_ASSET_KEY,
              role: "image",
              required: true,
              mimeTypes: IMAGE_MIME_TYPES,
              path: parsed.imagePath,
            },
          ]
        : []),
    ],
    content: {
      collection: parsed.collection ?? "academic",
      audio: {
        durationSec: parsed.audio.durationSec,
        assetKey: LISTENING_AUDIO_ASSET_KEY,
        ...(parsed.audio.path ? { path: parsed.audio.path } : {}),
      },
      image: imageKey ? { assetKey: imageKey } : null,
      imagePath: parsed.imagePath,
      mapDiagram: parsed.mapDiagram,
      sections: parsed.sections,
      questions: parsed.questions,
      keyword1: parsed.keyword1,
      keyword2: parsed.keyword2,
      vocabulary: parsed.vocabulary,
      studyPack: parsed.studyPack,
    },
  };
}
