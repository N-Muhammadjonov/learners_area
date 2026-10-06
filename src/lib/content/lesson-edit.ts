import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions, lessonBlocks, lessons, type LessonBlockSnapshot } from "@/db/schema";
import { blockPayload, EMPTY_QUIZ, type EditableLessonBlock } from "@/lib/content/lesson-edit-shape";
import { saveContentDraft, type AuthoringActor, type AuthoringIssue } from "@/lib/content/authoring";
import { isLearningArea, type LearningArea } from "@/lib/content/learning-areas";
import { isLive } from "@/lib/services/cms/publication";
import { latestVersion, versionContent, versionIdentity, type VersionRecord } from "@/lib/content/versions";
import type { ImportTransaction } from "@/lib/import/core/dry-run";
import type { VersionWriter } from "@/lib/content/authoring";

// The editable shape lives in a client-safe module (the desk is a client component);
// it is re-exported here so the server projection and its consumers keep one import.
export { blockPayload };
export type { EditableLessonBlock };

/**
 * THE EDITABLE LESSON — what the authoring desk loads when a staff member selects a
 * lesson, and the one operation that starts a revision of a published one.
 *
 * Why this module exists: a list row is not an editor. The desk used to hydrate itself
 * from the list (`title`, `slug`, `sourceRef`) and leave Description, Teacher Notes,
 * estimated time and every block EMPTY — so pressing Save on an existing lesson would
 * have written a blank lesson over real content. A list must stay lightweight, and the
 * object being edited has to be loaded exactly, from the revision store, through a
 * bounded staff-only projection. That is this projection.
 *
 * Two truths are kept apart on purpose, because conflating them is how a "draft" ends up
 * rewriting what students are reading:
 *
 *   • the LESSON ROW is a materialized view of whichever revision is LIVE;
 *   • a DRAFT REVISION is a proposal that lives in `content_versions` until an
 *     administrator or the owner publishes it.
 *
 * So the editor reads the draft when one exists and the row otherwise, and saving never
 * touches the row of a live lesson (see `saveLessonStructure`).
 */

export type LessonRevisionRef = { versionId: string; versionNo: number };

export type LessonEditModel = {
  lessonId: string;
  sourceRef: string;
  title: string;
  slug: string;
  unitId: string;
  learningArea: LearningArea | null;
  summary: string | null;
  teacherNotes: string | null;
  estimatedMinutes: number | null;
  /** The lesson ROW's publication state — what students are served right now. */
  lessonState: string;
  live: boolean;
  /** The editable revision. Null means "start a revision before saving" on a live lesson. */
  draft: LessonRevisionRef | null;
  /** The revision students are reading, when one exists. */
  published: (LessonRevisionRef & { title: string }) | null;
  /** A revision already committed to a moment: shown, never edited in place. */
  scheduled: LessonRevisionRef | null;
  pastRevisions: number;
  blocks: EditableLessonBlock[];
  /** Where the editable content came from, so the desk can say it truthfully. */
  contentSource: "draft" | "lesson";
};

/** A quiz answer is authored as text; anything else is left empty for the author to fix. */
function answerText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Snapshot block → editable block. Missing media metadata stays missing, never faked. */
export function editableBlockFromSnapshot(block: LessonBlockSnapshot): EditableLessonBlock {
  const quiz = block.quiz ?? null;
  return {
    type: String(block.type),
    text: block.text ?? null,
    url: block.url ?? null,
    objectKey: block.objectKey ?? null,
    originalName: (block.originalName as string | null | undefined) ?? null,
    mimeType: (block.mimeType as string | null | undefined) ?? null,
    size: (block.size as number | null | undefined) ?? null,
    ref: block.ref
      ? { module: block.ref.module, contentType: block.ref.contentType, sourceRef: block.ref.sourceRef, versionId: block.ref.versionId ?? null }
      : null,
    quiz: quiz
      ? {
          questionType: quiz.questionType ?? EMPTY_QUIZ.questionType,
          prompt: quiz.prompt ?? "",
          options: quiz.options ?? null,
          answer: answerText(quiz.answer),
          explanation: quiz.explanation ?? null,
        }
      : null,
  };
}

/** A `lesson_blocks` row → editable block, for a lesson whose content is the live row. */
export function editableBlockFromRow(row: typeof lessonBlocks.$inferSelect): EditableLessonBlock {
  const payload = (row.quizPayload ?? null) as { prompt?: unknown; options?: unknown; answer?: unknown; explanation?: unknown } | null;
  return {
    type: row.type,
    text: row.textContent ?? null,
    url: row.linkUrl ?? null,
    objectKey: row.objectKey ?? null,
    originalName: row.originalName ?? null,
    mimeType: row.mimeType ?? null,
    size: row.size ?? null,
    ref: row.refModule && row.refContentType && row.refSourceRef
      ? { module: row.refModule, contentType: row.refContentType, sourceRef: row.refSourceRef, versionId: row.refContentVersionId ?? null }
      : null,
    quiz: row.quizQuestionType
      ? {
          questionType: row.quizQuestionType,
          prompt: typeof payload?.prompt === "string" ? payload.prompt : "",
          options: Array.isArray(payload?.options) ? (payload.options as string[]) : null,
          answer: answerText(payload?.answer),
          explanation: typeof payload?.explanation === "string" ? payload.explanation : null,
        }
      : null,
  };
}


/** The newest revision of a lesson in a given lifecycle state. */
async function revisionOf(
  executor: { select: typeof db.select },
  sourceRef: string,
): Promise<VersionRecord[]> {
  const rows = await executor
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.module, "lesson"), eq(contentVersions.contentType, "lesson"), eq(contentVersions.sourceRef, sourceRef)))
    .orderBy(desc(contentVersions.versionNo));
  return rows as unknown as VersionRecord[];
}

/**
 * Load everything the desk shows for one lesson.
 *
 * Returns null for an unknown id — the same single answer as everywhere else, with no
 * information about whether the id merely belongs to somebody else's content.
 */
export async function loadLessonEditModel(
  lessonId: string,
  executor: { select: typeof db.select; query: typeof db.query } = db,
): Promise<LessonEditModel | null> {
  const [lesson] = await executor
    .select({
      id: lessons.id,
      title: lessons.title,
      slug: lessons.slug,
      unitId: lessons.unitId,
      sourceRef: lessons.sourceRef,
      learningArea: lessons.learningArea,
      summary: lessons.summary,
      teacherNotes: lessons.teacherNotes,
      estimatedMinutes: lessons.estimatedMinutes,
      publicationState: lessons.publicationState,
      publishAt: lessons.publishAt,
    })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  if (!lesson) return null;

  const sourceRef = lesson.sourceRef ?? "";
  const revisions = sourceRef ? await revisionOf(executor, sourceRef) : [];
  const draftRow = revisions.find((row) => row.status === "draft" && row.publicationState === "draft") ?? null;
  const scheduledRow = revisions.find((row) => row.publicationState === "scheduled") ?? null;
  const publishedRow = revisions.find((row) => row.status === "published" && row.publicationState === "published") ?? null;

  const rowBlocks = await executor
    .select()
    .from(lessonBlocks)
    .where(eq(lessonBlocks.lessonId, lessonId))
    .orderBy(asc(lessonBlocks.position));

  const live = isLive({ publicationState: lesson.publicationState, publishAt: lesson.publishAt });

  let blocks = rowBlocks.map(editableBlockFromRow);
  let contentSource: LessonEditModel["contentSource"] = "lesson";
  let title = lesson.title;
  let slug = lesson.slug;
  let unitId = lesson.unitId;
  let learningArea = isLearningArea(lesson.learningArea) ? (lesson.learningArea as LearningArea) : null;
  let summary = lesson.summary;
  let teacherNotes = lesson.teacherNotes;
  let estimatedMinutes = lesson.estimatedMinutes;

  if (draftRow) {
    const snapshot = (await versionContent(draftRow.id, executor)) as {
      unitId?: unknown;
      slug?: unknown;
      learningArea?: unknown;
      summary?: unknown;
      teacherNotes?: unknown;
      estimatedMinutes?: unknown;
      blocks?: unknown;
    } | null;
    if (snapshot && typeof snapshot === "object") {
      contentSource = "draft";
      if (Array.isArray(snapshot.blocks)) blocks = (snapshot.blocks as LessonBlockSnapshot[]).map(editableBlockFromSnapshot);
      // Fields a revision pinned before the snapshot recorded them fall back to the row:
      // the editor must never show a blank where the lesson has a value.
      if (typeof snapshot.unitId === "string" && snapshot.unitId) unitId = snapshot.unitId;
      if (typeof snapshot.slug === "string" && snapshot.slug) slug = snapshot.slug;
      if (isLearningArea(snapshot.learningArea)) learningArea = snapshot.learningArea as LearningArea;
      if (typeof snapshot.summary === "string" || snapshot.summary === null) summary = (snapshot.summary as string | null) ?? null;
      if (typeof snapshot.teacherNotes === "string" || snapshot.teacherNotes === null) teacherNotes = (snapshot.teacherNotes as string | null) ?? null;
      if (typeof snapshot.estimatedMinutes === "number" || snapshot.estimatedMinutes === null)
        estimatedMinutes = (snapshot.estimatedMinutes as number | null) ?? null;
      title = draftRow.title;
    }
  }

  return {
    lessonId: lesson.id,
    sourceRef,
    title,
    slug,
    unitId,
    learningArea,
    summary,
    teacherNotes,
    estimatedMinutes,
    lessonState: lesson.publicationState,
    live,
    draft: draftRow ? { versionId: draftRow.id, versionNo: draftRow.versionNo } : null,
    published: publishedRow ? { versionId: publishedRow.id, versionNo: publishedRow.versionNo, title: publishedRow.title } : null,
    scheduled: scheduledRow ? { versionId: scheduledRow.id, versionNo: scheduledRow.versionNo } : null,
    pastRevisions: revisions.length,
    blocks,
    contentSource,
  };
}

/**
 * The authored payload that reproduces an existing revision.
 *
 * Read from the revision's own canonical snapshot — never from the learner-rendered
 * HTML, never from the title, never assembled out of unrelated endpoints.
 */
function payloadFromSnapshot(
  snapshot: Record<string, unknown> | null,
  fallback: { unitId: string; slug: string; learningArea: LearningArea | null; summary: string | null; teacherNotes: string | null; estimatedMinutes: number | null; blocks: EditableLessonBlock[] },
) {
  const read = <T>(value: unknown, otherwise: T): T => (value === undefined || value === null ? otherwise : (value as T));
  return {
    unitId: read(snapshot?.unitId, fallback.unitId),
    slug: read(snapshot?.slug, fallback.slug),
    learningArea: isLearningArea(snapshot?.learningArea) ? (snapshot!.learningArea as LearningArea) : fallback.learningArea,
    summary: read(snapshot?.summary, fallback.summary),
    teacherNotes: read(snapshot?.teacherNotes, fallback.teacherNotes),
    estimatedMinutes: read(snapshot?.estimatedMinutes, fallback.estimatedMinutes),
    blocks: (Array.isArray(snapshot?.blocks) ? (snapshot!.blocks as LessonBlockSnapshot[]).map(editableBlockFromSnapshot) : fallback.blocks).map(blockPayload),
  };
}

export type StartRevisionResult =
  | { ok: true; version: VersionRecord; created: boolean; model: LessonEditModel }
  | { ok: false; issues: AuthoringIssue[] };

/**
 * START A REVISION: copy what students are reading into a new editable draft.
 *
 * The published revision is READ, never rewritten, and the copy keeps the same
 * `sourceRef` — one logical lesson with revisions, not a second lesson called
 * "... Copy". Opening the desk is not enough to create a revision: this runs only when
 * a staff member asks for it, and it is idempotent — if an editable draft already
 * exists it is returned instead of piling up another revision every time somebody looks
 * at the lesson.
 */
export async function startLessonRevision(
  tx: ImportTransaction & VersionWriter,
  input: { lessonId: string; actor: AuthoringActor; title?: string | null },
): Promise<StartRevisionResult> {
  const existing = await loadLessonEditModel(input.lessonId, tx as never);
  if (!existing) return { ok: false, issues: [{ code: "lesson_not_found", message: "That lesson does not exist." }] };
  if (existing.draft) {
    // Already being edited: open it. Never create a second draft by opening a page.
    const version = await latestVersion("lesson", "lesson", existing.sourceRef, tx as never);
    return version
      ? { ok: true, version, created: false, model: existing }
      : { ok: false, issues: [{ code: "draft_missing", message: "The editable revision could not be read." }] };
  }
  if (!existing.sourceRef) return { ok: false, issues: [{ code: "missing_source_ref", message: "That lesson has no stable reference, so it cannot be revised." }] };

  // The exact canonical content of the revision students are reading, when there is one.
  let snapshot: Record<string, unknown> | null = null;
  if (existing.published) {
    const content = await versionContent(existing.published.versionId, tx as never);
    snapshot = content && typeof content === "object" ? (content as Record<string, unknown>) : null;
  }

  const payload = payloadFromSnapshot(snapshot, {
    unitId: existing.unitId,
    slug: existing.slug,
    learningArea: existing.learningArea ?? "general",
    summary: existing.summary,
    teacherNotes: existing.teacherNotes,
    estimatedMinutes: existing.estimatedMinutes,
    blocks: existing.blocks,
  });

  const from = existing.published ? versionIdentity({ module: "lesson", contentType: "lesson", sourceRef: existing.sourceRef, versionNo: existing.published.versionNo }) : null;
  const title = (input.title ?? existing.title).trim() || existing.title;
  const saved = await saveContentDraft(tx, {
    actor: input.actor,
    module: "lesson",
    contentType: "lesson",
    sourceRef: existing.sourceRef,
    title,
    payload,
    // Revisions are never a new logical item: the same source ref, the same lesson id.
    note: from ? `Revision started from ${from}` : "Revision started",
    provenance: { origin: "revision", from },
    versionId: null,
  });
  if (!saved.ok) return { ok: false, issues: saved.issues };

  const model = await loadLessonEditModel(input.lessonId, tx as never);
  if (!model) return { ok: false, issues: [{ code: "lesson_not_found", message: "That lesson does not exist." }] };
  return { ok: true, version: saved.version, created: true, model };
}
