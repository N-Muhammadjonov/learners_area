import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { writingExamPaperEntries, writingExamPapers, writingGradeRequests, writingPrompts, writingSubmissions } from "@/db/schema";
import { findEvaluationsForSources } from "@/lib/data/evaluations";
import { liveWhere } from "@/lib/services/cms/publication";
import { countEssayWords, type WritingTask } from "@/lib/writing/grade-criteria";
import { EXAM_MODES, EXAM_SAVE_GRACE_SECONDS, type ExamMode } from "@/lib/writing/exam-modes";

type Database = typeof db;

/**
 * Real Exam (owner spec §38 / prompt §13, §8). The database clock is the only
 * clock: `started_at`/`expires_at` are written with `now()` in SQL and the
 * remaining time is always `expires_at - now()` computed by Postgres. Nothing
 * the browser sends (time, duration, deadline) is ever read.
 */

export type ExamEntryView = {
  position: number;
  taskType: WritingTask;
  promptId: string;
  prompt: string;
  category: string;
  targetWordCount: number;
  content: string;
  wordCount: number;
  revision: number;
  savedAt: string | null;
};

export type ExamPaperView = {
  id: string;
  mode: ExamMode;
  durationSeconds: number;
  startedAt: string;
  expiresAt: string;
  remainingSeconds: number;
  finalizedAt: string | null;
  finalizeReason: "submitted" | "timeout" | "abandoned" | null;
  entries: ExamEntryView[];
};

export type StartResult =
  | { ok: true; paper: ExamPaperView; resumed: boolean }
  | { ok: false; code: "no_prompts" | "other_paper_open"; openPaperId?: string; openMode?: ExamMode };

async function pickPrompt(database: Database, task: WritingTask) {
  const [row] = await database
    .select({ id: writingPrompts.id })
    .from(writingPrompts)
    .where(and(eq(writingPrompts.taskType, task), liveWhere({ publicationState: writingPrompts.publicationState, publishAt: writingPrompts.publishAt })))
    .orderBy(sql`random()`)
    .limit(1);
  return row?.id ?? null;
}

/** Close an open paper whose deadline (plus the final-flush grace) has passed. */
async function expireIfDue(database: Database, paperId: string) {
  const closed = await database
    .update(writingExamPapers)
    .set({ finalizedAt: sql`now()`, finalizeReason: "timeout" })
    .where(and(eq(writingExamPapers.id, paperId), isNull(writingExamPapers.finalizedAt),
      sql`now() > ${writingExamPapers.expiresAt} + make_interval(secs => ${EXAM_SAVE_GRACE_SECONDS})`))
    .returning({ id: writingExamPapers.id });
  if (closed.length) await markSubmitted(database, paperId);
}

async function markSubmitted(database: Database, paperId: string) {
  const entries = await database.select({ submissionId: writingExamPaperEntries.submissionId }).from(writingExamPaperEntries).where(eq(writingExamPaperEntries.paperId, paperId));
  if (!entries.length) return;
  await database.update(writingSubmissions)
    .set({ status: "submitted", submittedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(inArray(writingSubmissions.id, entries.map((e) => e.submissionId)), eq(writingSubmissions.status, "draft")));
}

export async function getExamPaper(userId: string, paperId: string, database: Database = db): Promise<ExamPaperView | null> {
  await expireIfDue(database, paperId);
  const [paper] = await database
    .select({
      id: writingExamPapers.id, mode: writingExamPapers.mode, durationSeconds: writingExamPapers.durationSeconds,
      startedAt: writingExamPapers.startedAt, expiresAt: writingExamPapers.expiresAt,
      finalizedAt: writingExamPapers.finalizedAt, finalizeReason: writingExamPapers.finalizeReason,
      remaining: sql<number>`greatest(0, ceil(extract(epoch from (${writingExamPapers.expiresAt} - now()))))::int`,
    })
    .from(writingExamPapers)
    .where(and(eq(writingExamPapers.id, paperId), eq(writingExamPapers.userId, userId)));
  if (!paper) return null;
  const entries = await database
    .select({
      position: writingExamPaperEntries.position, taskType: writingExamPaperEntries.taskType, promptId: writingPrompts.id,
      prompt: writingPrompts.prompt, category: writingPrompts.category, targetWordCount: writingPrompts.targetWordCount,
      content: writingSubmissions.content, wordCount: writingSubmissions.wordCount,
      revision: writingExamPaperEntries.draftRevision, savedAt: writingExamPaperEntries.savedAt,
    })
    .from(writingExamPaperEntries)
    .innerJoin(writingPrompts, eq(writingPrompts.id, writingExamPaperEntries.promptId))
    .innerJoin(writingSubmissions, eq(writingSubmissions.id, writingExamPaperEntries.submissionId))
    .where(eq(writingExamPaperEntries.paperId, paperId))
    .orderBy(asc(writingExamPaperEntries.position));
  return {
    id: paper.id, mode: paper.mode, durationSeconds: paper.durationSeconds,
    startedAt: new Date(paper.startedAt).toISOString(), expiresAt: new Date(paper.expiresAt).toISOString(),
    remainingSeconds: paper.finalizedAt ? 0 : Number(paper.remaining),
    finalizedAt: paper.finalizedAt ? new Date(paper.finalizedAt).toISOString() : null,
    finalizeReason: paper.finalizeReason ?? null,
    entries: entries.map((e) => ({ ...e, savedAt: e.savedAt ? new Date(e.savedAt).toISOString() : null })),
  };
}

export async function findOpenPaper(userId: string, database: Database = db) {
  const [open] = await database.select({ id: writingExamPapers.id, mode: writingExamPapers.mode })
    .from(writingExamPapers).where(and(eq(writingExamPapers.userId, userId), isNull(writingExamPapers.finalizedAt))).limit(1);
  if (!open) return null;
  await expireIfDue(database, open.id);
  const view = await getExamPaper(userId, open.id, database);
  return view && !view.finalizedAt ? view : null;
}

/**
 * Start a paper — or resume the learner's open one. A partial unique index
 * allows one open paper per learner, so a refresh, double-click or second tab
 * can never mint a second (fresh) deadline.
 */
export async function startExamPaper(userId: string, mode: ExamMode, database: Database = db): Promise<StartResult> {
  const open = await findOpenPaper(userId, database);
  if (open) {
    if (open.mode === mode) return { ok: true, paper: open, resumed: true };
    return { ok: false, code: "other_paper_open", openPaperId: open.id, openMode: open.mode };
  }
  const spec = EXAM_MODES[mode];
  const promptIds: string[] = [];
  for (const task of spec.tasks) {
    const id = await pickPrompt(database, task);
    if (!id) return { ok: false, code: "no_prompts" };
    promptIds.push(id);
  }
  let paperId: string;
  try {
    paperId = await database.transaction(async (tx) => {
      const [paper] = await tx.insert(writingExamPapers).values({
        userId, mode, durationSeconds: spec.durationSeconds,
        startedAt: sql`now()`, expiresAt: sql`now() + make_interval(secs => ${spec.durationSeconds})`,
      } as unknown as typeof writingExamPapers.$inferInsert).returning({ id: writingExamPapers.id });
      for (const [i, task] of spec.tasks.entries()) {
        const [sub] = await tx.insert(writingSubmissions).values({ userId, promptId: promptIds[i]!, content: "", wordCount: 0, status: "draft" }).returning({ id: writingSubmissions.id });
        await tx.insert(writingExamPaperEntries).values({ paperId: paper!.id, position: i + 1, taskType: task, promptId: promptIds[i]!, submissionId: sub!.id });
      }
      return paper!.id;
    });
  } catch (error) {
    // Lost a race with a concurrent Start: resume the winner instead of failing.
    const winner = await findOpenPaper(userId, database);
    if (winner) return winner.mode === mode ? { ok: true, paper: winner, resumed: true } : { ok: false, code: "other_paper_open", openPaperId: winner.id, openMode: winner.mode };
    throw error;
  }
  return { ok: true, paper: (await getExamPaper(userId, paperId, database))!, resumed: false };
}

export type SaveResult =
  | { ok: true; revision: number; savedAt: string; stale: boolean }
  | { ok: false; code: "not_found" | "closed" | "too_long" };

export const EXAM_MAX_CHARS = 20_000;

/**
 * Autosave one entry. Accepted while the paper is open and the deadline (plus a
 * short grace for the final in-flight flush) has not passed. A save whose
 * revision is not newer than the stored one is ignored, so an out-of-order
 * request can never replace newer text with older text.
 */
export async function saveExamDraft(userId: string, paperId: string, position: number, content: string, revision: number, database: Database = db): Promise<SaveResult> {
  if (content.length > EXAM_MAX_CHARS) return { ok: false, code: "too_long" };
  const [row] = await database
    .select({
      submissionId: writingExamPaperEntries.submissionId, current: writingExamPaperEntries.draftRevision,
      finalizedAt: writingExamPapers.finalizedAt,
      open: sql<boolean>`now() <= ${writingExamPapers.expiresAt} + make_interval(secs => ${EXAM_SAVE_GRACE_SECONDS})`,
    })
    .from(writingExamPaperEntries)
    .innerJoin(writingExamPapers, eq(writingExamPapers.id, writingExamPaperEntries.paperId))
    .where(and(eq(writingExamPaperEntries.paperId, paperId), eq(writingExamPaperEntries.position, position), eq(writingExamPapers.userId, userId)));
  if (!row) return { ok: false, code: "not_found" };
  if (row.finalizedAt || !row.open) { await expireIfDue(database, paperId); return { ok: false, code: "closed" }; }
  const updated = await database.update(writingExamPaperEntries)
    .set({ draftRevision: revision, savedAt: sql`now()` })
    .where(and(eq(writingExamPaperEntries.paperId, paperId), eq(writingExamPaperEntries.position, position), sql`${writingExamPaperEntries.draftRevision} < ${revision}`))
    .returning({ savedAt: writingExamPaperEntries.savedAt });
  if (!updated.length) return { ok: true, revision: row.current, savedAt: new Date().toISOString(), stale: true };
  await database.update(writingSubmissions)
    .set({ content, wordCount: countEssayWords(content), updatedAt: sql`now()` })
    .where(eq(writingSubmissions.id, row.submissionId));
  return { ok: true, revision, savedAt: new Date(updated[0]!.savedAt!).toISOString(), stale: false };
}

/** Submit (or abandon) a paper. Idempotent: a second call returns the stored state. */
export async function finalizeExamPaper(userId: string, paperId: string, reason: "submitted" | "abandoned", database: Database = db) {
  await expireIfDue(database, paperId);
  const closed = await database.update(writingExamPapers)
    .set({ finalizedAt: sql`now()`, finalizeReason: reason })
    .where(and(eq(writingExamPapers.id, paperId), eq(writingExamPapers.userId, userId), isNull(writingExamPapers.finalizedAt)))
    .returning({ id: writingExamPapers.id });
  if (closed.length && reason === "submitted") await markSubmitted(database, paperId);
  return getExamPaper(userId, paperId, database);
}

export async function listMyExamPapers(userId: string, database: Database = db) {
  return database.select({
    id: writingExamPapers.id, mode: writingExamPapers.mode, startedAt: writingExamPapers.startedAt,
    finalizedAt: writingExamPapers.finalizedAt, finalizeReason: writingExamPapers.finalizeReason,
  }).from(writingExamPapers).where(eq(writingExamPapers.userId, userId)).orderBy(sql`${writingExamPapers.startedAt} desc`).limit(10);
}

/** Live prompt counts per task, for the exam home cards (no fake numbers). */
export async function examPromptAvailability(database: Database = db) {
  const rows = await database.select({ task: writingPrompts.taskType, n: sql<number>`count(*)::int` })
    .from(writingPrompts)
    .where(liveWhere({ publicationState: writingPrompts.publicationState, publishAt: writingPrompts.publishAt }))
    .groupBy(writingPrompts.taskType);
  const by = Object.fromEntries(rows.map((r) => [r.task, Number(r.n)])) as Partial<Record<WritingTask, number>>;
  return { task1: by.task1 ?? 0, task2: by.task2 ?? 0 };
}

/** The Grade My Work idempotency key for one exam entry: one AI grade per entry, ever. */
export function examGradeKey(paperId: string, position: number) {
  return `exam_${paperId}_${position}`;
}

/** Existing AI grades (if any) for a finalized paper's entries, keyed by position. */
export async function examEntryGrades(userId: string, paper: ExamPaperView, database: Database = db) {
  const keys = paper.entries.map((e) => examGradeKey(paper.id, e.position));
  const rows = await database.select({ id: writingGradeRequests.id, key: writingGradeRequests.idempotencyKey, status: writingGradeRequests.status })
    .from(writingGradeRequests).where(and(eq(writingGradeRequests.userId, userId), inArray(writingGradeRequests.idempotencyKey, keys)));
  const evaluated = rows.filter((r) => r.status === "evaluated").map((r) => r.id);
  const evals = evaluated.length ? await findEvaluationsForSources({ sourceType: "writing_grade", sourceIds: evaluated }) : new Map();
  const out = new Map<number, { requestId: string; status: string; overall: number | null }>();
  for (const e of paper.entries) {
    const r = rows.find((x) => x.key === examGradeKey(paper.id, e.position));
    if (!r) continue;
    const ev = evals.get(r.id) as { providerType?: string; fallbackUsed?: boolean; overallEstimate?: number | null } | undefined;
    out.set(e.position, { requestId: r.id, status: r.status, overall: ev && ev.providerType === "external" && !ev.fallbackUsed ? ev.overallEstimate ?? null : null });
  }
  return out;
}
