import { and, asc, eq, inArray } from "drizzle-orm";
import { isLearningArea, type LearningArea } from "@/lib/content/learning-areas";
import { db } from "@/db/client";
import { lessonBlockResponses, lessonBlocks, lessonProgress, lessons, type LessonBlockSnapshot } from "@/db/schema";
import { gradeLessonQuiz, validateLessonBlocks, validateLessonForPublication, type LessonBlockInput, type LessonBlockIssue } from "@/lib/content/blocks";
import { contentTypeKey, moduleDescriptor, referenceProblems } from "@/lib/content/taxonomy";
import { latestVersion, pinVersion, versionContent, versionById, type VersionRecord } from "@/lib/content/versions";
import type { ImportTransaction } from "@/lib/import/core/dry-run";
import { isLive } from "@/lib/services/cms/publication";

/**
 * LESSONS — the course layer, built on the same canonical machinery as every
 * other content type (§26, §27, §28).
 *
 * A lesson is a versioned content item whose content is a list of typed native
 * blocks. That gives it, without inventing anything new:
 *
 *   - revision history through `pinVersion` (module `lesson`, content type `lesson`);
 *   - the same publication gate as every other content type: a draft lesson is
 *     invisible to learners, an archived one stays readable for those who took it;
 *   - references to canonical content by (module, content type, source ref) with an
 *     optional pinned revision — a lesson never copies material into itself, so
 *     fixing a passage fixes it in every lesson that points at it;
 *   - quiz blocks graded through the shared question-type registry.
 *
 * Learner reads only ever see live content: both the lesson row and any referenced
 * revision are checked, so a lesson cannot act as a side door to a draft.
 */

export type LessonActor = { id: string; role: string; mayPublish: boolean };

export type SaveLessonInput = {
  actor: LessonActor;
  /** Which unit the lesson lives in. Creating a lesson always attaches it to structure. */
  unitId: string;
  slug: string;
  title: string;
  summary?: string | null;
  /**
   * What the lesson is ABOUT. Required at authoring time so every new lesson is
   * explicitly classified; the column stays nullable for historical rows.
   */
  learningArea: LearningArea;
  /** The centre's own notes for this lesson — lesson metadata, not media metadata. */
  teacherNotes?: string | null;
  estimatedMinutes?: number | null;
  sourceRef: string;
  order?: number;
  blocks: LessonBlockInput[];
  /** Existing lesson id when revising. */
  lessonId?: string | null;
  /**
   * The editable draft revision this save continues, when the caller named one. It is
   * written in place (see `pinVersion`), so an author editing a lesson always saves into
   * the revision they opened instead of accumulating a new one per save.
   */
  targetVersionId?: string | null;
};

/**
 * What one lesson revision records.
 *
 * The metadata is part of the revision, not decoration around it: a snapshot that held
 * only `blocks` would forget what the lesson was about, what its description said and
 * what the centre's notes were at the moment it was pinned. `lessonAuthor` returns THIS
 * object to the caller's own pin, so the two revisions the authoring pipeline writes
 * (the lesson author's and `saveContentDraft`'s) can never spell the snapshot
 * differently.
 *
 * Revisions pinned before migration 0050 hold `{ blocks }` only. They stay readable:
 * consumers read the metadata fields defensively and fall back to the lesson row.
 */
export type LessonVersionContent = {
  /**
   * The lesson's own identity as it was when the revision was pinned. It is here
   * because the lesson ROW is a materialized view of the live revision: when a
   * revision is published, these values are written back onto the row, so the
   * snapshot has to carry everything the learner reads (see `materializeLessonRow`).
   * Revisions pinned before this field existed lack it; materialization then keeps
   * the row's current value rather than inventing one.
   */
  unitId?: string | null;
  slug?: string | null;
  order?: number | null;
  learningArea: LearningArea;
  summary: string | null;
  teacherNotes: string | null;
  estimatedMinutes: number | null;
  blocks: LessonBlockSnapshot[];
};

export type SaveLessonResult =
  | { ok: true; lessonId: string; version: VersionRecord; created: boolean; blockCount: number; content: LessonVersionContent }
  | { ok: false; issues: LessonBlockIssue[] };

/** The same bound the database CHECK constraint enforces on `lessons.teacher_notes`. */
export const LESSON_TEACHER_NOTES_MAX = 8000;

function slugRef(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

const lesssonIssue = (code: string, message: string, field?: string): LessonBlockIssue => ({ code, message, field });

/* -------------------------------------------------------------------------- */
/* Block rows: written like an editor, not like a bulk replace                 */
/* -------------------------------------------------------------------------- */

/** The shape a block row is written from. One function, so every writer agrees. */
function blockRowValues(block: LessonBlockInput, position: number) {
  return {
    position,
    type: block.type as never,
    textContent: block.text ?? null,
    linkUrl: block.url ?? null,
    objectKey: block.objectKey ?? null,
    originalName: block.originalName ?? null,
    mimeType: block.mimeType ?? null,
    size: block.size ?? null,
    refModule: block.ref?.module ?? null,
    refContentType: block.ref?.contentType ?? null,
    refSourceRef: block.ref?.sourceRef ?? null,
    refContentVersionId: block.ref?.versionId ?? null,
    quizQuestionType: block.quiz?.questionType ?? null,
    quizPayload: block.quiz
      ? { prompt: block.quiz.prompt, options: block.quiz.options ?? null, answer: block.quiz.answer, explanation: block.quiz.explanation ?? null }
      : null,
  };
}

/**
 * What makes two blocks "the same block" across a save.
 *
 * Deliberately content-based and position-free: an author who inserts a paragraph at
 * the top of a lesson has not changed the quiz below it, and the quiz block's row —
 * with the id a learner's answer is stored against — must survive that.
 */
function signatureOf(values: {
  type: string;
  textContent: string | null;
  linkUrl: string | null;
  objectKey: string | null;
  refModule: string | null;
  refContentType: string | null;
  refSourceRef: string | null;
  refContentVersionId: string | null;
  quizQuestionType: string | null;
  quizPayload: unknown;
}): string {
  return JSON.stringify([
    values.type,
    values.textContent,
    values.linkUrl,
    values.objectKey,
    values.refModule,
    values.refContentType,
    values.refSourceRef,
    values.refContentVersionId,
    values.quizQuestionType,
    values.quizPayload ?? null,
  ]);
}

/**
 * Write a lesson's block rows so that UNCHANGED blocks keep their row id.
 *
 * Why this is not a delete-and-reinsert: `lesson_block_responses.block_id` references
 * these rows `ON DELETE CASCADE`. A bulk replace therefore destroys every learner's
 * answers to blocks that were not touched — a data-loss defect that would surface the
 * first time a teacher fixed a typo in a published lesson's text block. Blocks whose
 * content is unchanged keep their identity; only genuinely new blocks are inserted and
 * only genuinely removed ones are deleted.
 *
 * Positions are unique per lesson, so the reuse is staged: rows that will keep existing
 * move to temporary negative positions first, then new rows take their final positions,
 * then the kept rows move into theirs.
 */
async function writeLessonBlocks(
  tx: ImportTransaction & { insert: typeof db.insert; update: typeof db.update; delete: typeof db.delete },
  lessonId: string,
  blocks: LessonBlockInput[],
): Promise<void> {
  const existing = await tx
    .select()
    .from(lessonBlocks)
    .where(eq(lessonBlocks.lessonId, lessonId))
    .orderBy(asc(lessonBlocks.position));

  // A brand-new lesson (or one that had no blocks) is a plain insert.
  if (existing.length === 0) {
    if (blocks.length === 0) return;
    await tx.insert(lessonBlocks).values(blocks.map((block, index) => ({ lessonId, ...blockRowValues(block, index + 1) })));
    return;
  }

  const used = new Set<string>();
  const plan = blocks.map((block, index) => {
    const signature = signatureOf(blockRowValues(block, index + 1));
    const match = existing.find((row) => !used.has(row.id) && signatureOf(row) === signature) ?? null;
    if (match) used.add(match.id);
    return { block, index, row: match };
  });

  const dropped = existing.filter((row) => !used.has(row.id));
  const kept = plan.filter((entry) => entry.row).map((entry) => entry.row!);

  if (dropped.length) await tx.delete(lessonBlocks).where(inArray(lessonBlocks.id, dropped.map((row) => row.id)));
  for (const [index, row] of kept.entries())
    await tx.update(lessonBlocks).set({ position: -(index + 1) }).where(eq(lessonBlocks.id, row.id));

  const inserted = plan.filter((entry) => !entry.row);
  if (inserted.length)
    await tx.insert(lessonBlocks).values(inserted.map((entry) => ({ lessonId, ...blockRowValues(entry.block, entry.index + 1) })));

  // Step 4: the kept rows move from their staging positions into their final ones. The
  // plan has exactly one entry per final position, so a kept row can never land on a
  // position an inserted row already took.
  for (const entry of plan) {
    if (!entry.row) continue;
    await tx
      .update(lessonBlocks)
      .set(blockRowValues(entry.block, entry.index + 1))
      .where(eq(lessonBlocks.id, entry.row.id));
  }
}

/**
 * Make a lesson ROW describe a published revision.
 *
 * The row is a materialized view of the live revision: while a lesson is live and a
 * revision is being edited, the row keeps serving the published content, and this is
 * what moves it forward — called from the shared publication service the moment a
 * revision becomes live for learners.
 *
 * Values the snapshot does not carry (a revision pinned before the snapshot recorded
 * the lesson's identity) keep whatever the row already had: nothing is invented and
 * nothing is blanked.
 */
export async function materializeLessonRow(
  tx: ImportTransaction & { insert: typeof db.insert; update: typeof db.update; delete: typeof db.delete },
  lessonId: string,
  content: Partial<LessonVersionContent> & { blocks?: LessonBlockSnapshot[] | null },
): Promise<void> {
  const [row] = await tx.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!row) return;
  const blocks = Array.isArray(content.blocks) ? (content.blocks as unknown as LessonBlockInput[]) : null;
  await tx
    .update(lessons)
    .set({
      ...(typeof content.unitId === "string" && content.unitId ? { unitId: content.unitId } : {}),
      ...(typeof content.slug === "string" && content.slug ? { slug: content.slug } : {}),
      ...(typeof content.order === "number" ? { order: content.order } : {}),
      ...(content.learningArea ? { learningArea: content.learningArea } : {}),
      summary: content.summary ?? null,
      teacherNotes: content.teacherNotes ?? null,
      estimatedMinutes: content.estimatedMinutes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(lessons.id, lessonId));
  if (blocks) await writeLessonBlocks(tx, lessonId, blocks);
}

/**
 * Persist a lesson and its blocks, then pin the revision that describes them.
 * Refuses before writing anything when a block is invalid, so a half-authored
 * lesson cannot exist.
 */
export async function saveLessonStructure(
  tx: ImportTransaction & { insert: typeof db.insert; update: typeof db.update },
  input: SaveLessonInput,
): Promise<SaveLessonResult> {
  const issues: LessonBlockIssue[] = [];
  if (!input.title.trim()) issues.push(lesssonIssue("missing_title", "A lesson needs a title.", "title"));
  if (!input.unitId) issues.push(lesssonIssue("missing_unit", "A lesson must belong to a unit.", "unitId"));
  if (slugRef(input.sourceRef) !== input.sourceRef)
    issues.push(lesssonIssue("unstable_source_ref", "A source reference must be lower-case a–z, 0–9, dot, dash or underscore.", "sourceRef"));
  if (!isLearningArea(input.learningArea))
    issues.push(lesssonIssue("missing_learning_area", "A lesson must name its learning area (listening, reading, writing, speaking, grammar, vocabulary or general).", "learningArea"));
  // Notes are bounded and never blank: an empty note is stored as NULL, so "has teacher
  // notes" stays one unambiguous question.
  if (typeof input.teacherNotes === "string" && input.teacherNotes.length > LESSON_TEACHER_NOTES_MAX)
    issues.push(lesssonIssue("teacher_notes_too_long", `Teacher notes must stay under ${LESSON_TEACHER_NOTES_MAX} characters.`, "teacherNotes"));
  issues.push(...validateLessonBlocks(input.blocks));
  if (issues.length) return { ok: false, issues };

  // A reference must be coherent with the shared taxonomy before anything is stored.
  for (const [index, block] of input.blocks.entries()) {
    if (block.type !== "content_reference" || !block.ref) continue;
    if (slugRef(block.ref.sourceRef) !== block.ref.sourceRef)
      return {
        ok: false,
        issues: [lesssonIssue("unstable_source_ref", "A referenced source ref must be a stable slug.", `blocks.${index}.ref.sourceRef`)],
      };
    const descriptor = moduleDescriptor(block.ref.module);
    if (!descriptor || !descriptor.contentTypes.includes(block.ref.contentType))
      return {
        ok: false,
        issues: [
          lesssonIssue(
            "unknown_content_type",
            `"${block.ref.module}:${block.ref.contentType}" is not a known content type.`,
            `blocks.${index}.ref.contentType`,
          ),
        ],
      };
  }

  const existingById = input.lessonId
    ? (await tx.select().from(lessons).where(eq(lessons.id, input.lessonId)).limit(1))[0]
    : undefined;
  const existingByRef =
    existingById ?? (await tx.select().from(lessons).where(eq(lessons.sourceRef, input.sourceRef)).limit(1))[0];

  /**
   * A lesson whose row is LIVE is never rewritten in place.
   *
   * Students are reading that row right now (and answering its quiz blocks), so a
   * save against a live lesson records a REVISION instead: the new content lands in
   * `content_versions` only, and the row keeps serving the published revision until
   * an administrator or the owner publishes the new one (`materializeLessonRow`).
   *
   * This replaces the old "a published lesson is frozen" refusal. The rule it
   * protected is intact and stronger: editing a live lesson can no longer change what
   * a learner sees, and editing can no longer *fail* just because the lesson is live.
   */
  const rowIsLive = existingByRef
    ? isLive({ publicationState: existingByRef.publicationState, publishAt: existingByRef.publishAt })
    : false;

  const teacherNotes = typeof input.teacherNotes === "string" && input.teacherNotes.trim().length > 0 ? input.teacherNotes : null;
  const values = {
    unitId: input.unitId,
    slug: input.slug,
    title: input.title.trim(),
    summary: input.summary ?? null,
    learningArea: input.learningArea,
    teacherNotes,
    estimatedMinutes: input.estimatedMinutes ?? null,
    sourceRef: input.sourceRef,
    updatedAt: new Date(),
  };

  let lessonId = existingByRef?.id;
  let created = false;
  if (lessonId) {
    if (!rowIsLive) {
      await tx.update(lessons).set(values).where(eq(lessons.id, lessonId));
      await writeLessonBlocks(tx, lessonId, input.blocks);
    }
  } else {
    const [row] = await tx
      .insert(lessons)
      .values({ ...values, order: input.order ?? 0, createdByUserId: input.actor.id, publicationState: "draft", defaultState: "locked" })
      .returning({ id: lessons.id });
    lessonId = row!.id;
    created = true;
    await writeLessonBlocks(tx, lessonId, input.blocks);
  }

  const snapshot: LessonBlockSnapshot[] = input.blocks.map((block, index) => ({
    position: index + 1,
    type: block.type,
    text: block.text ?? null,
    url: block.url ?? null,
    objectKey: block.objectKey ?? null,
    // Media metadata travels with the revision: a later revision copies this snapshot,
    // and a file whose name and size were dropped could not be shown to an author again.
    originalName: block.originalName ?? null,
    mimeType: block.mimeType ?? null,
    size: block.size ?? null,
    ref: block.ref ?? null,
    quiz: block.quiz ?? null,
  }));

  // ONE definition of the versioned representation, shared with `lessonAuthor`.
  // Backward compatibility: revisions pinned before 0050 contain `{ blocks }` only;
  // reading one must not break, so consumers read these fields defensively and fall
  // back to the lesson row.
  const content: LessonVersionContent = {
    unitId: input.unitId,
    slug: input.slug,
    order: input.order ?? null,
    learningArea: input.learningArea,
    summary: input.summary ?? null,
    teacherNotes,
    estimatedMinutes: input.estimatedMinutes ?? null,
    blocks: snapshot,
  };

  const pinned = await pinVersion(tx, {
    module: "lesson",
    contentType: "lesson",
    sourceRef: input.sourceRef,
    title: input.title.trim(),
    track: "unspecified",
    content,
    publicationState: "draft",
    // A live lesson cannot be edited in place: its revision must be a NEW row, even
    // when the payload is unchanged (that is exactly what "start a revision" saves).
    // Editing the draft of a live lesson is different — that draft already EXISTS, and
    // the save continues it (see `updateVersionId`).
    forceNewVersion: rowIsLive,
    updateVersionId: input.targetVersionId ?? null,
    targetType: "lesson",
    targetId: lessonId!,
    actorUserId: input.actor.id,
    provenance: { origin: "authored", blockCount: snapshot.length, learningArea: input.learningArea },
  });

  return { ok: true, lessonId: lessonId!, version: pinned.version, created, blockCount: snapshot.length, content };
}

/* -------------------------------------------------------------------------- */
/* Learner reads                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A quiz block as a LEARNER may see it: the prompt and the choices, never the key.
 * The answer and its explanation are only added once the learner has answered,
 * which is what keeps the answer-key security rule true on the client too (§81).
 */
export type LearnerQuizBlock = {
  questionType: string;
  prompt: string;
  options: string[] | null;
  /** Present only after this learner has answered. */
  answerKey?: unknown;
  explanation?: string | null;
};

export type ResolvedLessonBlock = Omit<LessonBlockSnapshot, "quiz"> & {
  /**
   * The stored block's id. A quiz block is ANSWERED by id
   * (`POST /api/lessons/blocks/:blockId/answer`), so the learner renderer needs it;
   * it is not a secret (the id is the learner's own row reference and carries no
   * answer), and the key itself still arrives only after the learner has answered.
   */
  blockId: string;
  quiz: LearnerQuizBlock | null;
  /** Published canonical content behind a reference, when the block has one. */
  referenced?: { module: string; contentType: string; sourceRef: string; versionId: string | null; content: unknown } | null;
  /** A reference problem is reported, never rendered as an empty block. */
  referenceProblem: string | null;
  /** For quiz blocks: whether the learner already answered, and the verdict. */
  response: { answer: unknown; correct: boolean | null; answeredAt: Date } | null;
};

export async function loadLessonForLearner(
  lessonId: string,
  userId: string,
  executor: { select: typeof db.select; query?: typeof db.query } = db,
): Promise<{
  lesson: typeof lessons.$inferSelect;
  blocks: ResolvedLessonBlock[];
  progress: { state: string; completedAt: Date | null } | null;
} | null> {
  const [lesson] = await executor.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson) return null;
  // A draft or archived lesson is not readable by a learner: the row itself decides.
  if (!isLive({ publicationState: lesson.publicationState, publishAt: lesson.publishAt })) return null;

  const rows = await executor.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, lessonId)).orderBy(asc(lessonBlocks.position));
  const responses = await executor
    .select()
    .from(lessonBlockResponses)
    .where(and(eq(lessonBlockResponses.lessonId, lessonId), eq(lessonBlockResponses.userId, userId)));
  const responseByBlock = new Map(responses.map((row) => [row.blockId, row]));

  const blocks: ResolvedLessonBlock[] = [];
  for (const row of rows) {
    const payload = (row.quizPayload ?? {}) as { prompt?: string; options?: string[] | null; answer?: unknown; explanation?: string | null };
    const answered = responseByBlock.get(row.id) ?? null;
    // The key is added BELOW, only when this learner has already answered.
    const quiz: LearnerQuizBlock | null = row.quizQuestionType
      ? { questionType: row.quizQuestionType, prompt: payload.prompt ?? "", options: payload.options ?? null }
      : null;
    const resolved: ResolvedLessonBlock = {
      blockId: row.id,
      position: row.position,
      type: row.type,
      text: row.textContent,
      url: row.linkUrl,
      objectKey: row.objectKey,
      ref: row.refSourceRef
        ? { module: row.refModule ?? "", contentType: row.refContentType ?? "", sourceRef: row.refSourceRef, versionId: row.refContentVersionId }
        : null,
      quiz,
      referenceProblem: null,
      response: null,
    };
    if (quiz && answered) {
      quiz.answerKey = payload.answer ?? null;
      quiz.explanation = payload.explanation ?? null;
    }
    if (row.type === "content_reference" && row.refModule && row.refContentType && row.refSourceRef) {
      const version = row.refContentVersionId
        ? await versionById(row.refContentVersionId, executor as never)
        : await latestVersion(row.refModule, row.refContentType, row.refSourceRef, executor as never);
      if (!version || version.status !== "published") {
        resolved.referenceProblem = "The referenced content is not published.";
      } else {
        const content = (await versionContent(version.id, executor as never)) ?? null;
        resolved.referenced = {
          module: row.refModule,
          contentType: row.refContentType,
          sourceRef: row.refSourceRef,
          versionId: version.id,
          content,
        };
      }
    }
    // Always present, so a caller never has to distinguish "answered: no" from
    // "this block type does not have responses".
    resolved.response = answered ? { answer: answered.answer, correct: answered.correct, answeredAt: answered.answeredAt } : null;
    blocks.push(resolved);
  }

  const [progressRow] = await executor
    .select({ state: lessonProgress.state, completedAt: lessonProgress.completedAt })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.lessonId, lessonId), eq(lessonProgress.userId, userId)))
    .limit(1);

  return { lesson, blocks, progress: progressRow ?? null };
}

/* -------------------------------------------------------------------------- */
/* Quiz answers                                                               */
/* -------------------------------------------------------------------------- */

export type AnswerQuizInput = {
  userId: string;
  blockId: string;
  answer: string;
};

export type AnswerQuizResult =
  | { ok: true; correct: boolean; correctAnswer: string | null }
  | { ok: false; reason: "block_not_found" | "not_a_quiz" | "unknown_question_type" | "lesson_not_live" };

/**
 * Answer one quiz block. The verdict comes from the canonical registry, is stored
 * once per learner per block, and the key is never returned to a learner before
 * they have answered — the answer travels with the response, not before it.
 */
export async function answerLessonQuiz(
  tx: ImportTransaction & { insert: typeof db.insert; update: typeof db.update },
  input: AnswerQuizInput,
): Promise<AnswerQuizResult> {
  const [block] = await tx.select().from(lessonBlocks).where(eq(lessonBlocks.id, input.blockId)).limit(1);
  if (!block) return { ok: false, reason: "block_not_found" };
  if (block.type !== "quiz" || !block.quizQuestionType || !block.quizPayload) return { ok: false, reason: "not_a_quiz" };

  const [lesson] = await tx.select().from(lessons).where(eq(lessons.id, block.lessonId)).limit(1);
  if (!lesson || !isLive({ publicationState: lesson.publicationState, publishAt: lesson.publishAt }))
    return { ok: false, reason: "lesson_not_live" };

  const payload = block.quizPayload as { prompt?: string; options?: string[] | null; answer?: unknown; explanation?: string | null };
  const graded = gradeLessonQuiz(block.quizQuestionType, {
    answer: input.answer,
    key: typeof payload.answer === "string" ? payload.answer : "",
    keys: Array.isArray(payload.answer) ? (payload.answer as string[]) : undefined,
    options: payload.options ?? undefined,
  });
  if (!graded) return { ok: false, reason: "unknown_question_type" };

  const values = {
    userId: input.userId,
    lessonId: block.lessonId,
    blockId: block.id,
    answer: { value: input.answer },
    correct: graded.correct,
    answeredAt: new Date(),
    updatedAt: new Date(),
  };
  const [existing] = await tx
    .select({ id: lessonBlockResponses.id })
    .from(lessonBlockResponses)
    .where(and(eq(lessonBlockResponses.userId, input.userId), eq(lessonBlockResponses.blockId, block.id)))
    .limit(1);
  if (existing) await tx.update(lessonBlockResponses).set(values).where(eq(lessonBlockResponses.id, existing.id));
  else await tx.insert(lessonBlockResponses).values(values);

  return { ok: true, correct: graded.correct, correctAnswer: graded.correct ? (typeof payload.answer === "string" ? payload.answer : null) : null };
}

/* -------------------------------------------------------------------------- */
/* Publication gate                                                           */
/* -------------------------------------------------------------------------- */

export type LessonPublicationGate = { canPublish: boolean; reasons: LessonBlockIssue[] };

/**
 * Whether a lesson revision may be handed to learners. Blocks are re-validated
 * here because the world moved: a referenced revision may have been archived, or
 * its content deleted, since the lesson was drafted.
 */
export async function lessonPublicationGate(lessonId: string, executor: { select: typeof db.select } = db): Promise<LessonPublicationGate> {
  const [lesson] = await executor.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  if (!lesson) return { canPublish: false, reasons: [lesssonIssue("not_found", "Unknown lesson.")] };

  const rows = await executor.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, lessonId)).orderBy(asc(lessonBlocks.position));
  const blocks: LessonBlockInput[] = rows.map((row) => ({
    type: row.type,
    text: row.textContent,
    url: row.linkUrl,
    objectKey: row.objectKey,
    ref: row.refSourceRef ? { module: row.refModule ?? "", contentType: row.refContentType ?? "", sourceRef: row.refSourceRef, versionId: row.refContentVersionId } : null,
    quiz: row.quizQuestionType
      ? ({ questionType: row.quizQuestionType, ...(row.quizPayload ?? {}) } as LessonBlockInput["quiz"])
      : null,
  }));
  const reasons = validateLessonForPublication(blocks);

  for (const [index, row] of rows.entries()) {
    if (row.type !== "content_reference" || !row.refModule || !row.refContentType || !row.refSourceRef) continue;
    const version = row.refContentVersionId
      ? await versionById(row.refContentVersionId, executor as never)
      : await latestVersion(row.refModule, row.refContentType, row.refSourceRef, executor as never);
    if (!version)
      reasons.push(lesssonIssue("reference_missing", `Block ${index + 1} references content that does not exist.`, `blocks.${index}`));
    else if (version.status === "archived")
      reasons.push(lesssonIssue("reference_archived", `Block ${index + 1} references an archived revision.`, `blocks.${index}`));
    for (const problem of referenceProblems(
      // The pinned revision travels with the target: requiring a version when one
      // IS pinned would report a phantom problem.
      { module: row.refModule, contentType: row.refContentType, sourceRef: row.refSourceRef, versionId: row.refContentVersionId },
      { requireVersion: Boolean(row.refContentVersionId) },
    ))
      if (problem.code !== "version_missing")
        reasons.push(lesssonIssue(problem.code, `Block ${index + 1}: ${problem.message}`, `blocks.${index}`));
  }

  const lessonVersions = await latestVersion("lesson", "lesson", lesson.sourceRef ?? "", executor as never);
  if (!lessonVersions) reasons.push(lesssonIssue("no_revision", "This lesson has no recorded revision to publish."));
  return { canPublish: reasons.length === 0, reasons };
}

/** Should a lesson reference be pinned to a revision, or follow the latest published one? */
export function referenceTargetLabel(ref: { module: string; contentType: string; sourceRef: string }): string {
  return `${contentTypeKey(ref.module, ref.contentType)}|${ref.sourceRef}`;
}
