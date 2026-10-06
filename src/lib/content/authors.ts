import type { z } from "zod";
import { z as zod } from "zod";
import {
  grammarExercises,
  grammarTopics,
  listeningQuestions,
  listeningTests,
  readingPassages,
  readingQuestions,
  speakingPrompts,
  writingPrompts,
} from "@/db/schema";
import { eq, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * A table whose rows carry publication columns. Erased to `PgTable` at this one
 * boundary because the caller supplies a concrete table and drizzle infers the
 * columns from it; passing the wrong table is caught where the table is named.
 */
type UpdateTarget = PgTable;
import type { ImportTransaction } from "@/lib/import/core/dry-run";
import { resolveQuestionType, storageTypeFor } from "@/lib/content/question-types";

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

export const listeningFullTestAuthor: ModuleAuthor = {
  module: "listening",
  contentType: "full_test",
  payloadVersion: 1,
  label: "Listening test",
  payloadSchema: listeningPayload,
  async persist(tx, payload, context) {
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
      summary: `Listening test with ${parsed.questions.length} question(s)`,
    };
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

export const readingSetAuthor: ModuleAuthor = {
  module: "reading",
  contentType: "general_set",
  payloadVersion: 1,
  label: "Reading set",
  payloadSchema: readingPayload,
  async persist(tx, payload, context) {
    const parsed = readingPayload.parse(payload);
    const passageIds: string[] = [];
    let questionCount = 0;

    // Re-authoring the set replaces its passages; the SET is one content item.
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
          // Every passage of the set shares the set's source ref: the SET is the
          // content item, and publication moves its passages together.
          sourceRef: context.sourceRef,
          passageNo: index + 1,
        })
        .returning({ id: readingPassages.id });
      passageIds.push(row!.id);
      await tx.insert(readingQuestions).values(
        passage.questions.map((question, qIndex) => ({
          passageId: row!.id,
          order: question.order ?? qIndex + 1,
          type: readingStorageType(question.typeCode),
          typeCode: question.typeCode,
          questionNo: question.questionNo ?? qIndex + 1,
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
      summary: `Reading set with ${passageIds.length} passage(s) and ${questionCount} question(s)`,
    };
  },
  async setPublication(tx, version, publication) {
    if (!version.sourceRef) return "target_missing";
    return syncRows(tx, readingPassages, eq(readingPassages.sourceRef, version.sourceRef), publication, true);
  },
  async readSchedule(tx, version) {
    const [row] = await tx
      .select({ publishAt: readingPassages.publishAt })
      .from(readingPassages)
      .where(eq(readingPassages.sourceRef, version.sourceRef))
      .limit(1);
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

let registered = false;

/**
 * Idempotent: registering authors twice is the same as registering them once, so
 * both the server route and the test can call it.
 */
export function registerModuleAuthors(): void {
  if (registered) return;
  registerModuleAuthor(listeningFullTestAuthor);
  registerModuleAuthor(readingSetAuthor);
  registerModuleAuthor(writingAuthor("task1"));
  registerModuleAuthor(writingAuthor("task2"));
  registerModuleAuthor(speakingAuthor("part1_question", "part1"));
  registerModuleAuthor(speakingAuthor("cue_card", "part2"));
  registerModuleAuthor(speakingAuthor("part3_question", "part3"));
  registerModuleAuthor(grammarTopicAuthor);
  registered = true;
}
