import type { z } from "zod";
import { z as zod } from "zod";
import {
  contentVersions,
  grammarExercises,
  grammarTopics,
  lessons,
  vocabularyTopicPacks,
  listeningQuestions,
  listeningTests,
  readingPassages,
  readingQuestions,
  speakingMaterials,
  speakingPrompts,
  writingLanguagePatterns,
  writingLessons,
  writingModelTexts,
  writingPrompts,
  writingTranslationSentences,
  writingTranslationSets,
} from "@/db/schema";
import { and, desc, eq, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * A table whose rows carry publication columns. Erased to `PgTable` at this one
 * boundary because the caller supplies a concrete table and drizzle infers the
 * columns from it; passing the wrong table is caught where the table is named.
 */
type UpdateTarget = PgTable;
import type { ImportTransaction } from "@/lib/import/core/dry-run";
import { resolveQuestionType, storageTypeFor } from "@/lib/content/question-types";
import { LESSON_TEACHER_NOTES_MAX, materializeLessonRow, saveLessonStructure } from "@/lib/content/lessons";
import { versionContent, type VersionRecord } from "@/lib/content/versions";
import { LEARNING_AREAS } from "@/lib/content/learning-areas";
import { LESSON_CATEGORIES, MODEL_TEXT_MIN_WORDS } from "@/lib/writing/admin-schemas";
import { PATTERN_FUNCTIONS } from "@/lib/writing/pattern-functions";
import { TRANSLATION_BANDS, TRANSLATION_QUESTION_TYPES } from "@/lib/writing/translation-rules";
import { saveTopicPack } from "@/lib/content/vocabulary-packs";
import { SPEAKING_MATERIAL_TARGET_TYPE, pinSpeakingMaterialVersion, type PinSpeakingMaterialInput } from "@/lib/services/speaking/materials";

/**
 * AUTHORS — how an in-app draft becomes canonical rows.
 *
 * Import and authoring are different CONTRACTS over the same canonical storage:
 *
 *   - an import arrives as a versioned file ENVELOPE, is hashed, may be dry-run,
 *     and is idempotent by `sourceRef`;
 *   - an authoring draft arrives as a validated form PAYLOAD, is written straight
 *     to the domain tables, and gets its identity from the row it created.
 *
 * Both then hand the same canonical content to `pinVersion`, which is why a
 * question created by hand and a question imported from a file behave identically
 * afterwards — same answer model, same grading, same versioning (§44).
 *
 * Every author declares its own zod schema for the AUTHORING payload. Where the
 * import registry already declares the canonical shape for that
 * `module:contentType`, the author REUSES it rather than restating it; the two
 * must never drift into two spellings of one question.
 */

export type AuthorContext = {
  actorUserId: string;
  sourceRef: string;
  title: string;
  track: string;
  /**
   * The editable revision the caller is saving into, when it named one. An author that
   * keeps a working copy (a lesson draft) writes that revision in place instead of
   * churning a new revision per save; authors that do not care ignore it.
   */
  versionId?: string | null;
};

export type AuthoredTarget = {
  targetType: string;
  targetId: string;
  /** The canonical content handed to `pinVersion`, so the version hashes what was written. */
  content: unknown;
  /** Rows the author created, so a refused publication can name them. */
  summary: string;
};

/** The publication fields a content row can hold, in the shared CMS vocabulary. */
export type PublicationPoint = { state: string; publishAt: Date | null };

export type PublicationSync = "ok" | "unsupported_schedule" | "target_missing";

export type ModuleAuthor = {
  module: string;
  contentType: string;
  /** `module:contentType:v1` shape of the payload, mirroring the import envelope. */
  payloadVersion: number;
  label: string;
  payloadSchema: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  persist: (tx: ImportTransaction, payload: unknown, context: AuthorContext) => Promise<AuthoredTarget>;
  /**
   * Move the CONTENT row's own visibility with its revision. Learner queries read
   * the content row, so publishing a revision that leaves the row unreadable would
   * publish nothing. Returns `unsupported_schedule` when the row cannot hold a
   * moment (no `publish_at` column) — in that case scheduling is refused rather
   * than silently treated as publishing.
   */
  setPublication: (
    tx: ImportTransaction,
    version: { targetId: string | null; sourceRef: string },
    publication: PublicationPoint,
  ) => Promise<PublicationSync>;
  /** The moment a scheduled revision opens, read from the content row itself. */
  readSchedule: (tx: ImportTransaction, version: { targetId: string | null; sourceRef: string }) => Promise<Date | null>;
  /**
   * Write the learner-visible content rows from a revision that is BECOMING LIVE.
   *
   * Most content types write their rows when they are authored, because a draft row is
   * invisible to learners anyway. That is not true of a content type whose row is
   * SERVED WHILE IT IS LIVE (a lesson): there, a draft revision must not touch the row
   * at all, and the row has to catch up at the moment the revision is published.
   *
   * Optional, because a type that writes its rows up front has nothing to do here.
   * Called inside the publication transaction, after the revision's state change: if it
   * cannot write, the whole publication rolls back rather than leaving learners on old
   * content while the revision claims to be live.
   */
  materialize?: (tx: ImportTransaction, input: { version: VersionRecord; content: unknown }) => Promise<void>;
};

/**
 * Update the publication columns of the rows that carry a content item.
 *
 * The table argument is erased on purpose and narrowed once per author, where the
 * concrete table is known: every target here has `publication_state`, and all but
 * grammar also have `publish_at`, which is exactly the difference the caller is
 * told about.
 */
async function syncRows(
  tx: ImportTransaction,
  table: UpdateTarget,
  where: SQL | undefined,
  publication: PublicationPoint,
  supportsSchedule: boolean,
): Promise<PublicationSync> {
  if (publication.state === "scheduled" && !supportsSchedule) return "unsupported_schedule";
  await tx.update(table).set({ publicationState: publication.state, publishAt: publication.publishAt }).where(where);
  return "ok";
}

const authors = new Map<string, ModuleAuthor>();

function authorKey(module: string, contentType: string): string {
  return `${module}:${contentType}`;
}

export function registerModuleAuthor(author: ModuleAuthor): void {
  const key = authorKey(author.module, author.contentType);
  const existing = authors.get(key);
  if (existing && existing !== author) throw new Error(`Duplicate content author registration: ${key}`);
  authors.set(key, author);
}

export function resolveModuleAuthor(module: string, contentType: string): ModuleAuthor | undefined {
  return authors.get(authorKey(module, contentType));
}

export function listRegisteredAuthors(): { module: string; contentType: string; label: string }[] {
  return [...authors.values()]
    .map(({ module, contentType, label }) => ({ module, contentType, label }))
    .sort((a, b) => a.module.localeCompare(b.module) || a.contentType.localeCompare(b.contentType));
}

/**
 * Whether the authoring workspace may offer "create from scratch" (§35). It is a
 * capability query, not a promise: a content type with no author says so honestly
 * instead of opening an empty form that silently writes nothing.
 */
export function canAuthor(module: string, contentType: string): boolean {
  return authors.has(authorKey(module, contentType));
}

/* -------------------------------------------------------------------------- */
/* Listening                                                                   */
/* -------------------------------------------------------------------------- */

const listeningQuestionPayload = zod.object({
  order: zod.number().int().min(1).optional(),
  /** Canonical Listening type id (`questionType` id) or an alias the registry knows. */
  type: zod.string().min(2).max(40),
  questionText: zod.string().min(3),
  options: zod.array(zod.string().min(1)).min(2).max(6).optional(),
  correctAnswer: zod.string().min(1),
  explanation: zod.string().min(1),
  keywords: zod.string().max(400).optional(),
  paraphrase: zod.object({ heard: zod.string().min(1), asked: zod.string().min(1) }).optional(),
});

const listeningPayload = zod.object({
  audioType: zod.enum(["video", "audio", "file", "link"]).default("audio"),
  difficultyLevel: zod.string().min(2).max(10).default("B2"),
  audioUrl: zod.string().min(1).optional(),
  transcript: zod.string().optional(),
  questions: zod.array(listeningQuestionPayload).min(1),
});

/**
 * The canonical projection of an authored listening test: exactly the shape the
 * import pipeline produces, so `semanticHashOf`/`gradeForType` behave identically
 * for a test that was typed into a form and one that arrived as a package (§44).
 */
function listeningProjection(parsed: zod.infer<typeof listeningPayload>): { questions: Record<string, unknown>[] } {
  return {
    questions: parsed.questions.map((question, index) => {
      const type = resolveQuestionType(question.type, "listening");
      return {
        order: question.order ?? index + 1,
        type: type?.id ?? question.type,
        storageType: storageTypeFor(type?.id ?? question.type, "listening") ?? "short_answer",
        questionText: question.questionText,
        options: question.options ?? null,
        correctAnswer: question.correctAnswer,
        ...(question.keywords ? { keywords: question.keywords } : {}),
        ...(question.paraphrase ? { paraphrases: [question.paraphrase] } : {}),
      };
    }),
  };
}

/**
 * The Listening persist path, shared by the full-test and section content types.
 *
 * Both write the SAME domain rows (a test and its questions) and hand the SAME
 * canonical projection to `pinVersion`; what differs is the content type an item is
 * filed under, which is what keeps a practice section from being mistaken for a full
 * test in the catalogue, in a mock composition and in a revision history.
 */
async function persistListening(
  tx: Parameters<ModuleAuthor["persist"]>[0],
  payload: unknown,
  context: AuthorContext & { contentLabel: string },
): Promise<AuthoredTarget> {
  const parsed = listeningPayload.parse(payload);
  // Every question type must be one the registry grades; an unknown one is
  // refused BEFORE any row is written rather than stored and graded by guesswork.
  for (const [index, question] of parsed.questions.entries())
    if (!resolveQuestionType(question.type, "listening"))
      throw new AuthoringPayloadError("listening", new zod.ZodError([
        { code: zod.ZodIssueCode.custom, path: ["questions", index, "type"], message: `Unknown Listening question type "${question.type}".` },
      ]));

  // One content ITEM is one row: re-authoring the same source ref revises it,
  // it does not create a second copy (§43).
  const [existingTest] = await tx
    .select({ id: listeningTests.id, publicationState: listeningTests.publicationState })
    .from(listeningTests)
    .where(eq(listeningTests.sourceRef, context.sourceRef))
    .limit(1);

  const [test] = existingTest
    ? await tx
        .update(listeningTests)
        .set({
          title: context.title,
          audioType: parsed.audioType,
          audioUrl: parsed.audioUrl ?? null,
          transcript: parsed.transcript ?? null,
          difficultyLevel: parsed.difficultyLevel,
        })
        .where(eq(listeningTests.id, existingTest.id))
        .returning({ id: listeningTests.id })
    : await tx
        .insert(listeningTests)
        .values({
          createdByUserId: context.actorUserId,
          title: context.title,
          audioType: parsed.audioType,
          audioUrl: parsed.audioUrl ?? null,
          transcript: parsed.transcript ?? null,
          sourceRef: context.sourceRef,
          difficultyLevel: parsed.difficultyLevel,
          publicationState: "draft",
        })
        .returning({ id: listeningTests.id });

  if (existingTest) await tx.delete(listeningQuestions).where(eq(listeningQuestions.testId, test!.id));
  await tx.insert(listeningQuestions).values(
    parsed.questions.map((question, index) => {
      const type = resolveQuestionType(question.type, "listening")!;
      return {
        testId: test!.id,
        order: question.order ?? index + 1,
        type: (storageTypeFor(type.id, "listening") ?? "short_answer") as "multiple_choice" | "short_answer",
        typeCode: type.id,
        questionText: question.questionText,
        options: question.options ?? null,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        keywords: question.keywords ?? null,
        paraphrases: question.paraphrase ? [question.paraphrase] : null,
      };
    }),
  );

  return {
    targetType: "listening_test",
    targetId: test!.id,
    content: listeningProjection(parsed),
    summary: `Listening ${context.contentLabel} with ${parsed.questions.length} question(s)`,
  };
}

/** A section is a SHORT practice item: one recording, a handful of questions. */
const listeningSectionPayload = listeningPayload.extend({
  questions: zod.array(listeningQuestionPayload).min(1).max(12),
  sectionNo: zod.number().int().min(1).max(4).default(1),
});

function listeningSectionProjection(parsed: zod.infer<typeof listeningSectionPayload>) {
  return { sectionNo: parsed.sectionNo, ...listeningProjection(parsed) };
}

export const listeningFullTestAuthor: ModuleAuthor = {
  module: "listening",
  contentType: "full_test",
  payloadVersion: 1,
  label: "Listening test",
  payloadSchema: listeningPayload,
  persist: (tx, payload, context) => persistListening(tx, payload, { ...context, contentLabel: "test" }),
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, listeningTests, eq(listeningTests.id, version.targetId), publication, true);
  },
  async readSchedule(tx, version) {
    if (!version.targetId) return null;
    const [row] = await tx.select({ publishAt: listeningTests.publishAt }).from(listeningTests).where(eq(listeningTests.id, version.targetId)).limit(1);
    return row?.publishAt ?? null;
  },
};

export const listeningSectionAuthor: ModuleAuthor = {
  module: "listening",
  contentType: "section",
  payloadVersion: 1,
  label: "Listening section",
  payloadSchema: listeningSectionPayload,
  async persist(tx, payload, context) {
    const parsed = listeningSectionPayload.parse(payload);
    const target = await persistListening(tx, parsed, { ...context, contentLabel: `section ${parsed.sectionNo}` });
    return { ...target, content: listeningSectionProjection(parsed), summary: `Listening section ${parsed.sectionNo} with ${parsed.questions.length} question(s)` };
  },
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, listeningTests, eq(listeningTests.id, version.targetId), publication, true);
  },
  async readSchedule(tx, version) {
    if (!version.targetId) return null;
    const [row] = await tx.select({ publishAt: listeningTests.publishAt }).from(listeningTests).where(eq(listeningTests.id, version.targetId)).limit(1);
    return row?.publishAt ?? null;
  },
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

const readingQuestionPayload = zod.object({
  order: zod.number().int().min(1).optional(),
  /** Canonical Reading type id or an alias the registry knows. */
  typeCode: zod.string().min(3).max(40),
  questionText: zod.string().min(3),
  options: zod.array(zod.string().min(1)).min(2).max(6).optional(),
  correctAnswer: zod.string().min(1),
  evidenceQuote: zod.string().optional(),
  explanation: zod.string().min(1),
  questionNo: zod.number().int().min(1).optional(),
});

const readingPayload = zod.object({
  difficultyLevel: zod.string().min(2).max(10).default("B2"),
  suggestedMinutes: zod.number().int().min(5).max(90).default(20),
  passages: zod
    .array(
      zod.object({
        title: zod.string().min(3).max(200),
        bodyText: zod.string().min(50),
        questions: zod.array(readingQuestionPayload).min(1),
      }),
    )
    .min(1),
});

function readingStorageType(typeCode: string): "true_false_not_given" | "yes_no_not_given" | "multiple_choice" | "short_answer" {
  const type = resolveQuestionType(typeCode, "reading");
  if (!type) throw new AuthoringPayloadError("reading", new zod.ZodError([
    { code: zod.ZodIssueCode.custom, path: ["questions", "typeCode"], message: `Unknown Reading question type "${typeCode}".` },
  ]));
  if (type.id === "true_false_not_given" || type.id === "yes_no_not_given") return type.id;
  return type.storageType === "multiple_choice" ? "multiple_choice" : "short_answer";
}

/**
 * The Reading persist path, shared by set-shaped and single-passage content types.
 * One SET is one content item: re-authoring replaces its passages rather than
 * creating a second copy, and every passage of the item shares its source ref so
 * publication moves them together (§41/§43).
 */
async function persistReading(
  tx: Parameters<ModuleAuthor["persist"]>[0],
  payload: unknown,
  context: AuthorContext,
): Promise<AuthoredTarget> {
  const parsed = readingPayload.parse(payload);
  const passageIds: string[] = [];
  let questionCount = 0;

  const existing = await tx.select({ id: readingPassages.id }).from(readingPassages).where(eq(readingPassages.sourceRef, context.sourceRef));
  if (existing.length) await tx.delete(readingPassages).where(eq(readingPassages.sourceRef, context.sourceRef));

  for (const [index, passage] of parsed.passages.entries()) {
    const [row] = await tx
      .insert(readingPassages)
      .values({
        title: passage.title,
        bodyText: passage.bodyText,
        difficultyLevel: parsed.difficultyLevel,
        suggestedMinutes: parsed.suggestedMinutes,
        publicationState: "draft",
        // Every passage of the item shares the item's source ref: the item is the
        // content unit, and publication moves its passages together.
        sourceRef: context.sourceRef,
        passageNo: index + 1,
      })
      .returning({ id: readingPassages.id });
    passageIds.push(row!.id);

    if (passage.questions.length)
      await tx.insert(readingQuestions).values(
        passage.questions.map((question, qIndex) => ({
          passageId: row!.id,
          order: question.order ?? qIndex + 1,
          questionNo: question.questionNo ?? qIndex + 1,
          type: readingStorageType(question.typeCode),
          typeCode: question.typeCode,
          questionText: question.questionText,
          options: question.options ?? null,
          correctAnswer: question.correctAnswer,
          evidenceQuote: question.evidenceQuote ?? null,
          explanation: question.explanation,
        })),
      );
    questionCount += passage.questions.length;
  }

  return {
    targetType: "reading_passage",
    targetId: passageIds[0]!,
    content: {
      passages: parsed.passages.map((passage) => ({
        title: passage.title,
        bodyText: passage.bodyText,
        questions: passage.questions.map((question) => ({ ...question, typeCode: resolveQuestionType(question.typeCode, "reading")?.id ?? question.typeCode })),
      })),
      timeLimitMinutes: parsed.suggestedMinutes,
    },
    summary: `Reading item with ${passageIds.length} passage(s) and ${questionCount} question(s)`,
  };
}

export const readingSetAuthor: ModuleAuthor = {
  module: "reading",
  contentType: "general_set",
  payloadVersion: 1,
  label: "Reading set",
  payloadSchema: readingPayload,
  persist: persistReading,
  async setPublication(tx, version, publication) {
    if (!version.sourceRef) return "target_missing";
    return syncRows(tx, readingPassages, eq(readingPassages.sourceRef, version.sourceRef), publication, true);
  },
  async readSchedule(tx, version) {
    const [row] = await tx.select({ publishAt: readingPassages.publishAt }).from(readingPassages).where(eq(readingPassages.sourceRef, version.sourceRef)).limit(1);
    return row?.publishAt ?? null;
  },
};

/** One passage is a legitimate item of its own: a teacher practising a single text. */
const singlePassagePayload = readingPayload.extend({ passages: zod.array(readingPayload.shape.passages.element).length(1) });

export const readingPassageAuthor: ModuleAuthor = {
  module: "reading",
  contentType: "passage",
  payloadVersion: 1,
  label: "Reading passage",
  payloadSchema: singlePassagePayload,
  persist: (tx, payload, context) => persistReading(tx, payload, context),
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, readingPassages, eq(readingPassages.sourceRef, version.sourceRef), publication, true);
  },
  async readSchedule(tx, version) {
    const [row] = await tx.select({ publishAt: readingPassages.publishAt }).from(readingPassages).where(eq(readingPassages.sourceRef, version.sourceRef)).limit(1);
    return row?.publishAt ?? null;
  },
};

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

const writingTaskPayload = zod.object({
  taskType: zod.enum(["task1", "task2"]),
  category: zod.string().min(2).max(60),
  prompt: zod.string().min(10),
  targetWordCount: zod.number().int().min(50).max(600),
});

function writingAuthor(taskType: "task1" | "task2"): ModuleAuthor {
  return {
    module: "writing",
    contentType: taskType,
    payloadVersion: 1,
    label: taskType === "task1" ? "Writing Task 1" : "Writing Task 2",
    payloadSchema: writingTaskPayload.refine((value) => value.taskType === taskType, {
      message: `This author writes ${taskType} prompts only`,
      path: ["taskType"],
    }),
    async persist(tx, payload, context) {
      const parsed = writingTaskPayload.parse(payload);
      if (parsed.taskType !== taskType) throw new Error(`writing:${taskType} author received ${parsed.taskType}`);
      const [existing] = await tx
        .select({ id: writingPrompts.id })
        .from(writingPrompts)
        .where(eq(writingPrompts.sourceRef, context.sourceRef))
        .limit(1);
      const values = {
        taskType,
        category: parsed.category,
        prompt: parsed.prompt,
        targetWordCount: parsed.targetWordCount,
      };
      const [row] = existing
        ? await tx.update(writingPrompts).set(values).where(eq(writingPrompts.id, existing.id)).returning({ id: writingPrompts.id })
        : await tx
            .insert(writingPrompts)
            .values({ ...values, publicationState: "draft", sourceRef: context.sourceRef })
            .returning({ id: writingPrompts.id });
      return {
        targetType: "writing_prompt",
        targetId: row!.id,
        content: {
          prompt: parsed.prompt,
          taskType,
          wordMinimum: parsed.targetWordCount,
          category: parsed.category,
        },
        summary: `Writing ${taskType} prompt`,
      };
    },
    async setPublication(tx, version, publication) {
      if (!version.targetId) return "target_missing";
      return syncRows(tx, writingPrompts, eq(writingPrompts.id, version.targetId), publication, true);
    },
    async readSchedule(tx, version) {
      if (!version.targetId) return null;
      const [row] = await tx.select({ publishAt: writingPrompts.publishAt }).from(writingPrompts).where(eq(writingPrompts.id, version.targetId)).limit(1);
      return row?.publishAt ?? null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Writing: the rest of the module                                              */
/* -------------------------------------------------------------------------- */

/**
 * The remaining Writing content types — `lesson`, `model_text`, `pattern` and
 * `translation_set` — are canonical through the SAME domain tables the app already
 * reads. There is no second store and no copy: the row IS the content, and the
 * revision pinned alongside it is what an assignment, a mock or an attempt can point
 * at (§24/§41/§43).
 *
 * Two identity rules matter here, and one of them is a trap:
 *
 *   • `lesson`, `model_text` and `translation_set` carry a `source_ref` column that no
 *     surface sets, so the canonical source ref is written there and re-authoring the
 *     same ref revises the same row.
 *   • `writing_language_patterns.source_ref` ALREADY means something else: the model
 *     text a pattern was drawn from (the admin form validates it as a model-text id).
 *     The canonical author must not overwrite that meaning, so it resolves the row to
 *     revise from the PREVIOUS revision's `target_id` instead — one item, still
 *     revised in place, without hijacking a column that means provenance.
 */
async function revisionTargetId(
  tx: ImportTransaction,
  module: string,
  contentType: string,
  sourceRef: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ targetId: contentVersions.targetId })
    .from(contentVersions)
    .where(and(eq(contentVersions.module, module), eq(contentVersions.contentType, contentType), eq(contentVersions.sourceRef, sourceRef)))
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  return row?.targetId ?? null;
}

const writingLessonPayload = zod.object({
  // The DB has the same CHECK (0031) — reusing the shared list means an invalid value
  // is refused as an authoring issue instead of surfacing as a raw constraint error.
  category: zod.enum(LESSON_CATEGORIES),
  summary: zod.string().max(600).nullable().optional(),
  body: zod.string().min(20).max(20000),
  durationMinutes: zod.number().int().min(1).max(240).nullable().optional(),
  position: zod.number().int().min(0).max(10000).default(0),
});

export const writingLessonAuthor: ModuleAuthor = {
  module: "writing",
  contentType: "lesson",
  payloadVersion: 1,
  label: "Writing lesson",
  payloadSchema: writingLessonPayload,
  async persist(tx, payload, context) {
    const parsed = writingLessonPayload.parse(payload);
    const values = {
      title: context.title,
      category: parsed.category,
      summary: parsed.summary ?? null,
      body: parsed.body,
      durationMinutes: parsed.durationMinutes ?? null,
      position: parsed.position,
      updatedAt: new Date(),
    };
    const [existing] = await tx.select({ id: writingLessons.id }).from(writingLessons).where(eq(writingLessons.sourceRef, context.sourceRef)).limit(1);
    const [row] = existing
      ? await tx.update(writingLessons).set(values).where(eq(writingLessons.id, existing.id)).returning({ id: writingLessons.id })
      : await tx
          .insert(writingLessons)
          .values({ ...values, sourceRef: context.sourceRef, publicationState: "draft" })
          .returning({ id: writingLessons.id });
    return {
      targetType: "writing_lesson",
      targetId: row!.id,
      content: { title: context.title, category: parsed.category, summary: parsed.summary ?? null, body: parsed.body, durationMinutes: parsed.durationMinutes ?? null },
      summary: "Writing lesson",
    };
  },
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, writingLessons, eq(writingLessons.id, version.targetId), publication, true);
  },
  async readSchedule(tx, version) {
    if (!version.targetId) return null;
    const [row] = await tx.select({ publishAt: writingLessons.publishAt }).from(writingLessons).where(eq(writingLessons.id, version.targetId)).limit(1);
    return row?.publishAt ?? null;
  },
};

const MODEL_TEXT_BANDS = [8, 8.5, 9] as const;

const writingModelTextPayload = zod
  .object({
    taskType: zod.enum(["task1", "task2"]),
    topic: zod.string().min(2).max(120),
    targetBand: zod.number().refine((band) => (MODEL_TEXT_BANDS as readonly number[]).includes(band), "A model text is Band 8, 8.5 or 9."),
    body: zod.string().min(200).max(8000),
    provenance: zod.string().min(2).max(200),
  })
  // A model text is a COMPLETE answer, never a prompt pretending to be one.
  .refine((value) => value.body.trim().split(/\s+/).length >= MODEL_TEXT_MIN_WORDS[value.taskType], {
    message: `A model text must be a complete answer: at least ${MODEL_TEXT_MIN_WORDS.task1} words for Task 1 and ${MODEL_TEXT_MIN_WORDS.task2} for Task 2.`,
    path: ["body"],
  });

export const writingModelTextAuthor: ModuleAuthor = {
  module: "writing",
  contentType: "model_text",
  payloadVersion: 1,
  label: "Model text",
  payloadSchema: writingModelTextPayload,
  async persist(tx, payload, context) {
    const parsed = writingModelTextPayload.parse(payload);
    const wordCount = parsed.body.trim().split(/\s+/).length;
    const values = {
      title: context.title,
      taskType: parsed.taskType,
      topic: parsed.topic,
      targetBand: String(parsed.targetBand) as never,
      body: parsed.body,
      wordCount,
      provenance: parsed.provenance,
    };
    const [existing] = await tx.select({ id: writingModelTexts.id }).from(writingModelTexts).where(eq(writingModelTexts.sourceRef, context.sourceRef)).limit(1);
    const [row] = existing
      ? await tx.update(writingModelTexts).set(values).where(eq(writingModelTexts.id, existing.id)).returning({ id: writingModelTexts.id })
      : await tx
          .insert(writingModelTexts)
          .values({ ...values, sourceRef: context.sourceRef, publicationState: "draft" })
          .returning({ id: writingModelTexts.id });
    return {
      targetType: "writing_model_text",
      targetId: row!.id,
      content: { title: context.title, taskType: parsed.taskType, topic: parsed.topic, targetBand: parsed.targetBand, body: parsed.body, wordCount, provenance: parsed.provenance },
      summary: `Model text at Band ${parsed.targetBand} (${wordCount} words)`,
    };
  },
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, writingModelTexts, eq(writingModelTexts.id, version.targetId), publication, true);
  },
  async readSchedule(tx, version) {
    if (!version.targetId) return null;
    const [row] = await tx.select({ publishAt: writingModelTexts.publishAt }).from(writingModelTexts).where(eq(writingModelTexts.id, version.targetId)).limit(1);
    return row?.publishAt ?? null;
  },
};

const writingPatternPayload = zod.object({
  pattern: zod.string().min(3).max(240),
  function: zod.enum(PATTERN_FUNCTIONS),
  taskType: zod.enum(["task1", "task2"]),
  topic: zod.string().max(120).nullable().optional(),
  targetBand: zod.number().int().min(5).max(9).nullable().optional(),
  example: zod.string().min(5).max(400),
  usageNote: zod.string().max(600).nullable().optional(),
  provenance: zod.string().min(2).max(200),
});

export const writingPatternAuthor: ModuleAuthor = {
  module: "writing",
  contentType: "pattern",
  payloadVersion: 1,
  label: "Language pattern",
  payloadSchema: writingPatternPayload,
  async persist(tx, payload, context) {
    const parsed = writingPatternPayload.parse(payload);
    const values = {
      pattern: parsed.pattern,
      function: parsed.function,
      taskType: parsed.taskType,
      topic: parsed.topic ?? null,
      targetBand: parsed.targetBand ?? null,
      example: parsed.example,
      usageNote: parsed.usageNote ?? null,
      provenance: parsed.provenance,
    };
    // `source_ref` on this table means "the model text this pattern came from", so the
    // canonical author never writes it: the row to revise comes from the previous
    // revision of this same canonical item.
    const previous = await revisionTargetId(tx, "writing", "pattern", context.sourceRef);
    const existing = previous
      ? (await tx.select({ id: writingLanguagePatterns.id }).from(writingLanguagePatterns).where(eq(writingLanguagePatterns.id, previous)).limit(1))[0]
      : undefined;
    const [row] = existing
      ? await tx.update(writingLanguagePatterns).set(values).where(eq(writingLanguagePatterns.id, existing.id)).returning({ id: writingLanguagePatterns.id })
      : await tx.insert(writingLanguagePatterns).values({ ...values, publicationState: "draft" }).returning({ id: writingLanguagePatterns.id });
    return {
      targetType: "writing_pattern",
      targetId: row!.id,
      content: { pattern: parsed.pattern, function: parsed.function, taskType: parsed.taskType, topic: parsed.topic ?? null, example: parsed.example, usageNote: parsed.usageNote ?? null },
      summary: `Pattern “${parsed.pattern}”`,
    };
  },
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, writingLanguagePatterns, eq(writingLanguagePatterns.id, version.targetId), publication, true);
  },
  async readSchedule(tx, version) {
    if (!version.targetId) return null;
    const [row] = await tx.select({ publishAt: writingLanguagePatterns.publishAt }).from(writingLanguagePatterns).where(eq(writingLanguagePatterns.id, version.targetId)).limit(1);
    return row?.publishAt ?? null;
  },
};

const writingTranslationSentencePayload = zod.object({
  position: zod.number().int().min(1).max(40),
  uzbekSource: zod.string().min(2).max(600),
  modelEnglish: zod.string().min(2).max(600),
  acceptedAlternatives: zod.array(zod.string().min(1).max(600)).max(10).default([]),
  notes: zod.array(zod.string().min(1).max(400)).max(5).default([]),
  targetLexicalItems: zod.array(zod.string().min(1).max(80)).max(10).default([]),
});

const writingTranslationSetPayload = zod.object({
  topic: zod.string().min(2).max(120),
  questionType: zod.enum(TRANSLATION_QUESTION_TYPES),
  taskType: zod.enum(["task1", "task2"]).default("task2"),
  targetBand: zod.number().int().refine((band) => (TRANSLATION_BANDS as readonly number[]).includes(band), "A translation set is Band 6, 7 or 8."),
  promptText: zod.string().min(10).max(2000),
  provenance: zod.string().min(2).max(200),
  sentences: zod.array(writingTranslationSentencePayload).max(40),
});

export const writingTranslationSetAuthor: ModuleAuthor = {
  module: "writing",
  contentType: "translation_set",
  payloadVersion: 1,
  label: "Translation set",
  payloadSchema: writingTranslationSetPayload,
  async persist(tx, payload, context) {
    const parsed = writingTranslationSetPayload.parse(payload);
    const positions = parsed.sentences.map((sentence) => sentence.position);
    if (new Set(positions).size !== positions.length)
      throw new AuthoringPayloadError("writing", new zod.ZodError([
        { code: zod.ZodIssueCode.custom, path: ["sentences"], message: "Two sentences share a position." },
      ]));
    const values = {
      title: context.title,
      topic: parsed.topic,
      questionType: parsed.questionType,
      taskType: parsed.taskType,
      targetBand: parsed.targetBand,
      promptText: parsed.promptText,
      provenance: parsed.provenance,
      updatedAt: new Date(),
    };
    const [existing] = await tx.select({ id: writingTranslationSets.id }).from(writingTranslationSets).where(eq(writingTranslationSets.sourceRef, context.sourceRef)).limit(1);
    const [row] = existing
      ? await tx.update(writingTranslationSets).set(values).where(eq(writingTranslationSets.id, existing.id)).returning({ id: writingTranslationSets.id })
      : await tx
          .insert(writingTranslationSets)
          .values({ ...values, sourceRef: context.sourceRef, publicationState: "draft" })
          .returning({ id: writingTranslationSets.id });
    await tx.delete(writingTranslationSentences).where(eq(writingTranslationSentences.setId, row!.id));
    if (parsed.sentences.length)
      await tx.insert(writingTranslationSentences).values(
        parsed.sentences.map((sentence) => ({
          setId: row!.id,
          position: sentence.position,
          uzbekSource: sentence.uzbekSource,
          modelEnglish: sentence.modelEnglish,
          acceptedAlternatives: sentence.acceptedAlternatives,
          notes: sentence.notes,
          targetLexicalItems: sentence.targetLexicalItems,
        })),
      );
    return {
      targetType: "writing_translation_set",
      targetId: row!.id,
      content: {
        title: context.title,
        topic: parsed.topic,
        questionType: parsed.questionType,
        taskType: parsed.taskType,
        targetBand: parsed.targetBand,
        promptText: parsed.promptText,
        sentences: parsed.sentences,
      },
      summary: `Translation set with ${parsed.sentences.length} sentence(s)`,
    };
  },
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, writingTranslationSets, eq(writingTranslationSets.id, version.targetId), publication, true);
  },
  async readSchedule(tx, version) {
    if (!version.targetId) return null;
    const [row] = await tx.select({ publishAt: writingTranslationSets.publishAt }).from(writingTranslationSets).where(eq(writingTranslationSets.id, version.targetId)).limit(1);
    return row?.publishAt ?? null;
  },
};

/* -------------------------------------------------------------------------- */
/* Speaking                                                                    */
/* -------------------------------------------------------------------------- */

const speakingPromptPayload = zod.object({
  part: zod.enum(["part1", "part2", "part3"]),
  category: zod.string().min(2).max(60),
  promptText: zod.string().min(3),
  cueCard: zod.string().max(2000).optional(),
  prepSeconds: zod.number().int().min(0).max(600).default(30),
  answerSeconds: zod.number().int().min(15).max(900).default(90),
  followUps: zod.array(zod.string().min(1)).max(12).default([]),
  topic: zod.string().max(200).optional(),
});

function speakingAuthor(contentType: string, part: "part1" | "part2" | "part3"): ModuleAuthor {
  return {
    module: "speaking",
    contentType,
    payloadVersion: 1,
    label: contentType === "cue_card" ? "Speaking cue card" : `Speaking ${part} question`,
    payloadSchema: speakingPromptPayload,
    async persist(tx, payload, context) {
      const parsed = speakingPromptPayload.parse(payload);
      if (parsed.part !== part) throw new Error(`speaking:${contentType} author received ${parsed.part}`);
      const values = {
        part,
        category: parsed.category as never,
        promptText: parsed.promptText,
        cueCard: parsed.cueCard ?? null,
        prepSeconds: parsed.prepSeconds,
        answerSeconds: parsed.answerSeconds,
        followUps: parsed.followUps,
        topic: parsed.topic ?? context.title,
      };
      const [existing] = await tx
        .select({ id: speakingPrompts.id })
        .from(speakingPrompts)
        .where(eq(speakingPrompts.externalId, context.sourceRef))
        .limit(1);
      const [row] = existing
        ? await tx.update(speakingPrompts).set(values).where(eq(speakingPrompts.id, existing.id)).returning({ id: speakingPrompts.id })
        : await tx
            .insert(speakingPrompts)
            .values({ ...values, publicationState: "draft", externalId: context.sourceRef })
            .returning({ id: speakingPrompts.id });
      return {
        targetType: "speaking_prompt",
        targetId: row!.id,
        content: {
          part,
          promptText: parsed.promptText,
          cueCard: parsed.cueCard ?? null,
          followUps: parsed.followUps,
          prepSeconds: parsed.prepSeconds,
          answerSeconds: parsed.answerSeconds,
        },
        summary: `Speaking ${part} prompt`,
      };
    },
    async setPublication(tx, version, publication) {
      if (!version.targetId) return "target_missing";
      return syncRows(tx, speakingPrompts, eq(speakingPrompts.id, version.targetId), publication, true);
    },
    async readSchedule(tx, version) {
      if (!version.targetId) return null;
      const [row] = await tx.select({ publishAt: speakingPrompts.publishAt }).from(speakingPrompts).where(eq(speakingPrompts.id, version.targetId)).limit(1);
      return row?.publishAt ?? null;
    },
  };
}

/*
 * Speaking materials (`speaking:material`).
 *
 * These rows are the Practice hub's lesson resources and the shadowing studio's
 * sources. The author owns the DESCRIPTIVE contract — a title, a category, a link
 * primary and the text of the material. It deliberately does not accept a file: an
 * attachment reaches a material only through the verified upload pipeline
 * (upload-intent → upload → finalize → claim), so there is no payload field for an
 * object key, and a payload that carries one is refused rather than stored.
 *
 * `shadowing` is one of the categories, not a second store: a shadowing material is
 * a material whose category is `shadowing`, read by the studio like any other.
 */
const speakingMaterialCategories = ["part1", "part2", "part3", "general", "shadowing", "top_structures"] as const;

/** Refused explicitly: a storage key may not ride in on an authoring payload. */
const FORBIDDEN_MATERIAL_KEYS = ["primaryObjectKey", "objectKey", "uploadId", "blocks"] as const;

const speakingMaterialPayload = zod
  .object({
    title: zod.string().min(3).max(200),
    category: zod.enum(speakingMaterialCategories),
    primaryType: zod.enum(["link", "video", "audio", "file"]),
    /** Required for a link primary; meaningless for the others (files arrive by upload). */
    primaryUrl: zod.string().url().max(2000).optional(),
    description: zod.string().max(4000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.primaryType === "link" && !value.primaryUrl)
      ctx.addIssue({ code: zod.ZodIssueCode.custom, path: ["primaryUrl"], message: "A link material needs its URL." });
    if (value.primaryType !== "link" && value.primaryUrl)
      ctx.addIssue({ code: zod.ZodIssueCode.custom, path: ["primaryUrl"], message: "A file is attached by upload, not by URL." });
  });

const speakingMaterialAuthor: ModuleAuthor = {
  module: "speaking",
  contentType: "material",
  payloadVersion: 1,
  label: "Speaking material",
  payloadSchema: speakingMaterialPayload,
  async persist(tx, payload, context) {
    for (const key of FORBIDDEN_MATERIAL_KEYS)
      if (payload && typeof payload === "object" && key in (payload as Record<string, unknown>))
        throw new Error(`speaking:material payload may not carry ${key}`);
    const parsed = speakingMaterialPayload.parse(payload);

    // Identity comes from the revision chain, not from the title: the previous
    // revision names the row this sourceRef already created.
    const [previous] = await tx
      .select({ targetId: contentVersions.targetId })
      .from(contentVersions)
      .where(
        and(
          eq(contentVersions.module, "speaking"),
          eq(contentVersions.contentType, "material"),
          eq(contentVersions.sourceRef, context.sourceRef),
        ),
      )
      .orderBy(desc(contentVersions.versionNo))
      .limit(1);

    let materialId: string | null = previous?.targetId ?? null;
    let current: { primaryType: string; primaryObjectKey: string | null; primaryUrl: string | null } | null = null;
    if (materialId) {
      const [row] = await tx
        .select({ id: speakingMaterials.id, primaryType: speakingMaterials.primaryType, primaryObjectKey: speakingMaterials.primaryObjectKey, primaryUrl: speakingMaterials.primaryUrl })
        .from(speakingMaterials)
        .where(eq(speakingMaterials.id, materialId))
        .limit(1);
      current = row ?? null;
      if (!row) materialId = null;
    }

    // An upload-backed material is not converted into a link by an edit; that would
    // throw away the file it actually serves.
    if (current?.primaryObjectKey && parsed.primaryType === "link")
      throw new Error("speaking:material is upload-backed; its primary is replaced through the upload flow, not by a URL");

    if (materialId) {
      await tx
        .update(speakingMaterials)
        .set({
          title: parsed.title,
          category: parsed.category as never,
          primaryType: parsed.primaryType as never,
          primaryUrl: parsed.primaryType === "link" ? parsed.primaryUrl! : current?.primaryUrl ?? null,
        })
        .where(eq(speakingMaterials.id, materialId));
    } else {
      const [created] = await tx
        .insert(speakingMaterials)
        .values({
          createdByUserId: context.actorUserId,
          category: parsed.category as never,
          title: parsed.title,
          primaryType: parsed.primaryType as never,
          primaryUrl: parsed.primaryType === "link" ? parsed.primaryUrl! : null,
          publicationState: "draft",
        })
        .returning({ id: speakingMaterials.id });
      materialId = created!.id;
    }

    return {
      targetType: SPEAKING_MATERIAL_TARGET_TYPE,
      targetId: materialId!,
      content: {
        title: parsed.title,
        category: parsed.category,
        primaryType: parsed.primaryType,
        primaryUrl: parsed.primaryType === "link" ? parsed.primaryUrl! : null,
        description: parsed.description ?? null,
      },
      summary: `Speaking material (${parsed.category})`,
    };
  },
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, speakingMaterials, eq(speakingMaterials.id, version.targetId), publication, true);
  },
  async readSchedule(tx, version) {
    if (!version.targetId) return null;
    const [row] = await tx.select({ publishAt: speakingMaterials.publishAt }).from(speakingMaterials).where(eq(speakingMaterials.id, version.targetId)).limit(1);
    return row?.publishAt ?? null;
  },
};

/* -------------------------------------------------------------------------- */
/* Grammar                                                                     */
/* -------------------------------------------------------------------------- */

const grammarTopicPayload = zod.object({
  title: zod.string().min(3).max(200),
  explanation: zod.string().min(5),
  skillArea: zod.enum(["writing", "speaking"]).default("writing"),
  order: zod.number().int().min(0).default(0),
  exercises: zod
    .array(
      zod.object({
        promptText: zod.string().min(3),
        options: zod.array(zod.string().min(1)).min(2).max(6),
        correctOption: zod.string().min(1),
        explanation: zod.string().min(3),
      }),
    )
    .min(1),
});

export const grammarTopicAuthor: ModuleAuthor = {
  module: "grammar",
  contentType: "topic",
  payloadVersion: 1,
  label: "Grammar topic",
  payloadSchema: grammarTopicPayload,
  async persist(tx, payload, context) {
    const parsed = grammarTopicPayload.parse(payload);
    const [existing] = await tx
      .select({ id: grammarTopics.id })
      .from(grammarTopics)
      .where(eq(grammarTopics.sourceRef, context.sourceRef))
      .limit(1);
    const values = { skillArea: parsed.skillArea, title: parsed.title, explanation: parsed.explanation, order: parsed.order };
    const [topic] = existing
      ? await tx.update(grammarTopics).set(values).where(eq(grammarTopics.id, existing.id)).returning({ id: grammarTopics.id })
      : await tx
          .insert(grammarTopics)
          .values({ ...values, sourceRef: context.sourceRef, publicationState: "draft" })
          .returning({ id: grammarTopics.id });
    if (existing) await tx.delete(grammarExercises).where(eq(grammarExercises.topicId, topic!.id));
    await tx.insert(grammarExercises).values(
      parsed.exercises.map((exercise, index) => ({
        topicId: topic!.id,
        order: index + 1,
        promptText: exercise.promptText,
        options: exercise.options,
        correctOption: exercise.correctOption,
        explanation: exercise.explanation,
      })),
    );
    return {
      targetType: "grammar_topic",
      targetId: topic!.id,
      content: { title: parsed.title, explanation: parsed.explanation, exercises: parsed.exercises },
      summary: `Grammar topic with ${parsed.exercises.length} exercise(s)`,
    };
  },
  // grammar_topics has no publish_at column: it can be a draft or published or
  // archived, but it cannot hold a MOMENT, so scheduling is refused rather than
  // stored as a schedule that would never open.
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, grammarTopics, eq(grammarTopics.id, version.targetId), publication, false);
  },
  async readSchedule() {
    return null;
  },
};

/* -------------------------------------------------------------------------- */
/* Registration                                                                */
/* -------------------------------------------------------------------------- */

export class AuthoringPayloadError extends Error {
  constructor(
    readonly scope: string,
    readonly issues: z.ZodError,
  ) {
    super(
      `${scope}: ${issues.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".") || "payload"} ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "AuthoringPayloadError";
  }
}

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

const vocabularyPackPayload = zod.object({
  labelEn: zod.string().min(2).max(120),
  labelUz: zod.string().max(120).optional().nullable(),
  slug: zod.string().min(2).max(60),
  topicCode: zod.string().max(40).optional().nullable(),
  level: zod.string().max(10).optional().nullable(),
  position: zod.number().int().min(0).optional(),
  words: zod
    .array(
      zod.object({
        term: zod.string().min(1).max(120),
        partOfSpeech: zod.string().max(30).default(""),
        definitionEn: zod.string().min(1).max(500),
        translationUz: zod.string().max(500).default(""),
        example: zod.string().min(1).max(500),
        collocations: zod.string().max(500).optional(),
      }),
    )
    .min(1),
});

/**
 * A vocabulary pack is canonical content whose WORDS are canonical senses (§31).
 * The author therefore writes no second word store: it delegates to
 * `saveTopicPack`, which resolves each word to a `lexemes` row.
 */
export const vocabularyTopicPackAuthor: ModuleAuthor = {
  module: "vocabulary",
  contentType: "topic_pack",
  payloadVersion: 1,
  label: "Vocabulary topic pack",
  payloadSchema: vocabularyPackPayload,
  async persist(tx, payload, context) {
    const parsed = vocabularyPackPayload.parse(payload);
    const result = await saveTopicPack(tx as never, {
      actorUserId: context.actorUserId,
      sourceRef: context.sourceRef,
      slug: parsed.slug,
      labelEn: parsed.labelEn,
      labelUz: parsed.labelUz ?? null,
      topicCode: parsed.topicCode ?? null,
      level: parsed.level ?? null,
      position: parsed.position ?? 0,
      words: parsed.words,
    });
    if (!result.ok)
      throw new AuthoringPayloadError(
        "vocabulary",
        new zod.ZodError(
          result.issues.map((issue) => ({ code: zod.ZodIssueCode.custom, path: [], message: issue.message })),
        ),
      );
    return {
      targetType: "vocabulary_topic_pack",
      targetId: result.packId,
      content: { labelEn: parsed.labelEn, words: parsed.words.map((word) => ({ term: word.term, partOfSpeech: word.partOfSpeech, definitionEn: word.definitionEn })) },
      summary: `Vocabulary pack with ${result.words} word(s)`,
    };
  },
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, vocabularyTopicPacks, eq(vocabularyTopicPacks.id, version.targetId), publication, true);
  },
  async readSchedule(tx, version) {
    if (!version.targetId) return null;
    const [row] = await tx
      .select({ publishAt: vocabularyTopicPacks.publishAt })
      .from(vocabularyTopicPacks)
      .where(eq(vocabularyTopicPacks.id, version.targetId))
      .limit(1);
    return row?.publishAt ?? null;
  },
};

/* -------------------------------------------------------------------------- */
/* Lesson                                                                      */
/* -------------------------------------------------------------------------- */

const lessonPayload = zod.object({
  // Every bound carries the sentence an AUTHOR reads. A refusal is shown to the person
  // who typed it: "String must contain at most 8000 character(s)" is a message about the
  // schema, not about their lesson, and the desk would have had to blur it.
  unitId: zod.string({ message: "Choose the unit this lesson belongs to." }).uuid("Choose the unit this lesson belongs to."),
  slug: zod
    .string()
    .min(2, "The slug must be at least two characters.")
    .max(60, "The slug must stay under 60 characters."),
  /**
   * What the lesson is about. REQUIRED, and intentionally the first field an author
   * must answer: the previous revision of this contract had no way to say it, which is
   * why a lesson's subject could only be guessed from its media or its title.
   */
  learningArea: zod.enum(LEARNING_AREAS, { message: "Choose the learning area this lesson is about." }),
  summary: zod
    .string()
    .max(2000, "The description must stay under 2000 characters.")
    .optional()
    .nullable(),
  /** The centre's own notes for the lesson — lesson metadata, independent of media. */
  teacherNotes: zod
    .string()
    .max(LESSON_TEACHER_NOTES_MAX, `Teacher notes must stay under ${LESSON_TEACHER_NOTES_MAX} characters.`)
    .optional()
    .nullable(),
  estimatedMinutes: zod
    .number()
    .int("Estimated minutes must be a whole number.")
    .min(1, "Estimated minutes must be at least 1.")
    .max(600, "Estimated minutes must stay under 600.")
    .optional()
    .nullable(),
  order: zod.number().int().min(0).optional(),
  blocks: zod.array(zod.unknown(), { message: "The lesson material could not be read." }).default([]),
});

/**
 * A lesson is authored through the SAME pipeline as every other content type: the
 * blocks are validated by the block contract, the domain rows are written, and the
 * revision is pinned. The lesson author therefore adds no new storage rules — it
 * reuses `saveLessonStructure`.
 */
export const lessonAuthor: ModuleAuthor = {
  module: "lesson",
  contentType: "lesson",
  payloadVersion: 1,
  label: "Lesson",
  payloadSchema: lessonPayload,
  async persist(tx, payload, context) {
    const parsed = lessonPayload.parse(payload);
    const result = await saveLessonStructure(tx as never, {
      actor: { id: context.actorUserId, role: "owner", mayPublish: true },
      targetVersionId: context.versionId ?? null,
      unitId: parsed.unitId,
      slug: parsed.slug,
      title: context.title,
      summary: parsed.summary ?? null,
      learningArea: parsed.learningArea,
      teacherNotes: parsed.teacherNotes ?? null,
      estimatedMinutes: parsed.estimatedMinutes ?? null,
      order: parsed.order,
      sourceRef: context.sourceRef,
      blocks: parsed.blocks as never,
    });
    if (!result.ok)
      throw new AuthoringPayloadError(
        "lesson",
        new zod.ZodError(
          result.issues.map((issue) => ({
            code: zod.ZodIssueCode.custom,
            path: issue.field ? issue.field.split(".") : [],
            message: issue.message,
          })),
        ),
      );
    return {
      targetType: "lesson",
      targetId: result.lessonId,
      // saveLessonStructure already pinned the revision; the author returns THAT
      // snapshot, so the caller's own pin is identical instead of being a second,
      // poorer spelling of it (which is how a `{ blocks }`-only revision was once
      // written over a lesson whose metadata had just been authored).
      content: result.content,
      summary: `Lesson with ${result.blockCount} block(s)`,
    };
  },
  async setPublication(tx, version, publication) {
    if (!version.targetId) return "target_missing";
    return syncRows(tx, lessons, eq(lessons.id, version.targetId), publication, true);
  },
  async readSchedule(tx, version) {
    if (!version.targetId) return null;
    const [row] = await tx.select({ publishAt: lessons.publishAt }).from(lessons).where(eq(lessons.id, version.targetId)).limit(1);
    return row?.publishAt ?? null;
  },
  /**
   * A lesson row IS what a learner reads, and while the lesson is live the row is left
   * alone by every draft save (see `saveLessonStructure`). So this is where an edited
   * revision reaches students — the moment an administrator or the owner publishes it,
   * and only then. Historical revisions are untouched: they keep their snapshots.
   */
  async materialize(tx, { version }) {
    if (!version.targetId) return;
    const content = await versionContent(version.id, tx as never);
    if (!content || typeof content !== "object") return;
    await materializeLessonRow(tx as never, version.targetId, content as Parameters<typeof materializeLessonRow>[2]);
  },
};

let registered = false;

/**
 * Idempotent: registering authors twice is the same as registering them once, so
 * both the server route and the test can call it.
 */
export function registerModuleAuthors(): void {
  if (registered) return;
  registerModuleAuthor(listeningFullTestAuthor);
  registerModuleAuthor(listeningSectionAuthor);
  registerModuleAuthor(readingSetAuthor);
  registerModuleAuthor(readingPassageAuthor);
  registerModuleAuthor(writingAuthor("task1"));
  registerModuleAuthor(writingAuthor("task2"));
  registerModuleAuthor(writingLessonAuthor);
  registerModuleAuthor(writingModelTextAuthor);
  registerModuleAuthor(writingPatternAuthor);
  registerModuleAuthor(writingTranslationSetAuthor);
  registerModuleAuthor(speakingAuthor("part1_question", "part1"));
  registerModuleAuthor(speakingAuthor("cue_card", "part2"));
  registerModuleAuthor(speakingAuthor("part3_question", "part3"));
  registerModuleAuthor(speakingMaterialAuthor);
  registerModuleAuthor(grammarTopicAuthor);
  registerModuleAuthor(lessonAuthor);
  registerModuleAuthor(vocabularyTopicPackAuthor);
  registered = true;
}
