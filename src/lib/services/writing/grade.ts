import "server-only";
import { and, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { writingGradeRequests } from "@/db/schema";
import { evaluateAndPersist, type ServiceOutcome } from "@/lib/services/coach/service";
import { findEvaluation, findEvaluationsForSources, type EvaluationRecord } from "@/lib/data/evaluations";
import { writingAnalysisSchema, type EvaluationResult, type WritingAnalysis } from "@/lib/services/coach/schema";
import { countEssayWords, normalizeWritingCriteria, criteriaFor, type WritingTask } from "@/lib/writing/grade-criteria";
import { writingContractKey } from "@/lib/services/coach/contracts/registry";
import type { AssessmentContractKey } from "@/lib/services/coach/contracts/types";

/**
 * Grade My Work (owner spec §42). Strict external AI grading:
 *  - the exact question + essay are saved as an immutable snapshot first
 *  - one claim per request means one provider call at a time
 *  - fallback policy "none": RIWI is never asked, so nothing is mislabelled AI
 *  - the server relabels the four criteria and derives the overall band
 *  - failure keeps the essay, records the reason, and allows a manual retry
 */
export const GRADE_SOURCE_TYPE = "writing_grade";
export const CLAIM_STALE_MS = 3 * 60_000;
type Database = typeof db;

export type GradeInput = { taskType: WritingTask; question: string; essay: string; idempotencyKey: string; promptId?: string | null; taskCategory?: string | null };

export async function createGradeRequest(userId: string, input: GradeInput, database: Database = db) {
  const inserted = await database.insert(writingGradeRequests).values({
    userId, taskType: input.taskType, questionText: input.question.trim(), essayText: input.essay,
    wordCount: countEssayWords(input.essay), idempotencyKey: input.idempotencyKey, promptId: input.promptId ?? null,
    taskCategory: input.taskCategory ?? null,
  }).onConflictDoNothing({ target: [writingGradeRequests.userId, writingGradeRequests.idempotencyKey] }).returning();
  if (inserted[0]) return { row: inserted[0], created: true };
  const existing = await database.query.writingGradeRequests.findFirst({
    where: and(eq(writingGradeRequests.userId, userId), eq(writingGradeRequests.idempotencyKey, input.idempotencyKey)),
  });
  if (!existing) throw new Error("grade_request_write_failed");
  return { row: existing, created: false };
}

/** Reject anything that is not an external, non-fallback, exact-four-criteria grade. */
export function normalizeGradeResult(task: WritingTask, result: EvaluationResult): EvaluationResult | null {
  if (result.providerType !== "external" || result.fallbackUsed) return null;
  const n = normalizeWritingCriteria(task, result.criteria);
  if (!n) return null;
  return { ...result, overallEstimate: n.overall, criteria: n.criteria.map((c) => ({ key: c.key, label: c.label, band: c.band, note: c.note })) };
}

/** Narrative keys follow the canonical criterion keys for the task. */
export function normalizeAnalysis(task: WritingTask, analysis: unknown): WritingAnalysis | null {
  const parsed = writingAnalysisSchema.safeParse(analysis);
  if (!parsed.success) return null;
  const keys = criteriaFor(task);
  const narratives = parsed.data.criterionNarratives;
  const canonical = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
  if (narratives.length !== keys.length
    || !keys.every((key, index) => canonical(narratives[index]?.key ?? "") === canonical(key))
    || narratives.some((item) => item.evidence.length === 0)) return null;
  return parsed.data;
}

export type GradeRunOutcome =
  | { ok: true; requestId: string }
  | { ok: false; requestId: string; error: "in_progress" | "not_found" | string };

type Evaluate = (params: Parameters<typeof evaluateAndPersist>[0]) => Promise<ServiceOutcome>;

export async function runGrade(requestId: string, userId: string, language: "uz" | "en", deps: { database?: Database; evaluate?: Evaluate } = {}): Promise<GradeRunOutcome> {
  const database = deps.database ?? db;
  const evaluate = deps.evaluate ?? evaluateAndPersist;
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS);
  const claimed = await database.update(writingGradeRequests)
    .set({ claimedAt: new Date() })
    .where(and(
      eq(writingGradeRequests.id, requestId), eq(writingGradeRequests.userId, userId),
      ne(writingGradeRequests.status, "evaluated"),
      or(isNull(writingGradeRequests.claimedAt), lt(writingGradeRequests.claimedAt, staleBefore)),
    )).returning();
  const row = claimed[0];
  if (!row) {
    const current = await database.query.writingGradeRequests.findFirst({ where: and(eq(writingGradeRequests.id, requestId), eq(writingGradeRequests.userId, userId)) });
    if (!current) return { ok: false, requestId, error: "not_found" };
    if (current.status === "evaluated") return { ok: true, requestId };
    return { ok: false, requestId, error: "in_progress" };
  }

  const task = row.taskType as WritingTask;
  const contractKey: AssessmentContractKey = row.taskCategory
    ? writingContractKey(task, row.taskCategory)
    : task === "task1" ? "writing.grade.task1" : "writing.grade.task2";
  let outcome: ServiceOutcome;
  try {
    outcome = await evaluate({
      userId, evaluationType: "writing", sourceType: GRADE_SOURCE_TYPE, sourceId: row.id, language,
      policy: { fallback: "none" },
      normalize: (result) => normalizeGradeResult(task, result),
      // Only what grading needs: no identity, profile or history (§42.7).
      request: {
        evaluationType: "writing",
        assessmentContractKey: contractKey,
        input: { taskType: task, prompt: row.questionText, content: row.essayText, targetWordCount: task === "task1" ? 150 : 250, detailedAnalysis: true, wordCount: row.wordCount },
      },
    });
  } catch {
    outcome = { ok: false, error: "evaluation_unavailable" };
  }

  if (!outcome.ok) {
    await database.update(writingGradeRequests).set({ status: "failed", lastError: outcome.error.slice(0, 60), claimedAt: null })
      .where(eq(writingGradeRequests.id, row.id));
    return { ok: false, requestId, error: outcome.error };
  }
  const analysis = outcome.extras?.writingAnalysis ? normalizeAnalysis(task, outcome.extras.writingAnalysis) : null;
  await database.update(writingGradeRequests).set({
    status: "evaluated", lastError: null, claimedAt: null, evaluatedAt: new Date(),
    ...(analysis ? { analysis } : {}),
  }).where(eq(writingGradeRequests.id, row.id));
  return { ok: true, requestId };
}

export async function getGradeView(requestId: string, userId: string, database: Database = db) {
  const request = await database.query.writingGradeRequests.findFirst({ where: and(eq(writingGradeRequests.id, requestId), eq(writingGradeRequests.userId, userId)) });
  if (!request) return null;
  const evaluation: EvaluationRecord | null = request.status === "evaluated" ? await findEvaluation({ sourceType: GRADE_SOURCE_TYPE, sourceId: request.id }) : null;
  // A persisted row that is somehow not an external grade is never shown as AI.
  const trusted = evaluation && evaluation.providerType === "external" && !evaluation.fallbackUsed ? evaluation : null;
  const analysis = request.analysis ? normalizeAnalysis(request.taskType as WritingTask, request.analysis) : null;
  return { request, evaluation: trusted, analysis };
}

export async function listMyEssays(userId: string, database: Database = db) {
  const rows = await database.select({
    id: writingGradeRequests.id, taskType: writingGradeRequests.taskType, questionText: sql<string>`left(${writingGradeRequests.questionText}, 160)`,
    wordCount: writingGradeRequests.wordCount, status: writingGradeRequests.status, createdAt: writingGradeRequests.createdAt,
  }).from(writingGradeRequests).where(eq(writingGradeRequests.userId, userId)).orderBy(desc(writingGradeRequests.createdAt)).limit(50);
  const evaluated = rows.filter((r) => r.status === "evaluated").map((r) => r.id);
  const evaluations = await findEvaluationsForSources({ sourceType: GRADE_SOURCE_TYPE, sourceIds: evaluated });
  return rows.map((r) => {
    const e = evaluations.get(r.id);
    return { ...r, overall: e && e.providerType === "external" && !e.fallbackUsed ? e.overallEstimate : null };
  });
}
