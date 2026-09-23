import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, coachWeaknesses, evaluations } from "@/db/schema";
import { categoriesCheckedBy, isWeaknessCategory } from "@/lib/services/coach/categories";
import {
  criterionSchema,
  evaluationIssueSchema,
  recommendedExerciseSchema,
  type Criterion,
  type EvaluationIssue,
  type EvaluationResult,
  type EvaluationType,
  type RecommendedExercise,
  type WeaknessCategory,
} from "@/lib/services/coach/schema";

/**
 * Persistence for Coach evaluations.
 *
 * Two rules are enforced here rather than in the UI:
 *
 *  1. Provider identity is stored *per row*. The label shown to a student is
 *     read from the row, never from current configuration, so changing
 *     AI_PRIMARY_PROVIDER cannot rewrite yesterday's feedback.
 *  2. There is one authoritative evaluation per submission. The unique index is
 *     the guarantee; `saveEvaluation` returns the existing row instead of
 *     inserting a competing one.
 */

export type EvaluationRecord = {
  id: string;
  userId: string;
  evaluationType: EvaluationType;
  sourceType: string;
  sourceId: string;
  providerId: string;
  providerDisplayName: string;
  providerType: "internal" | "external";
  providerVersion: string;
  model: string | null;
  promptVersion: string;
  rubricVersion: string;
  fallbackUsed: boolean;
  fallbackFrom: string | null;
  /** Denormalised label written from provider metadata at evaluation time. */
  checkedByName: string;
  /** Derived from the stored provider identity — never from current configuration. */
  checkedBy: { id: string; displayName: string; type: "internal" | "external" };
  overallEstimate: number | null;
  confidence: number;
  verdict: "correct" | "mostly_correct" | "needs_correction" | null;
  criteria: Criterion[];
  strengths: string[];
  weaknesses: string[];
  issues: EvaluationIssue[];
  nextActions: string[];
  recommendedExercises: RecommendedExercise[];
  processedInMs: number;
  createdAt: Date;
};

type EvaluationRow = typeof evaluations.$inferSelect;

/**
 * The jsonb columns are typed loosely at the database level; every read goes
 * back through the same schemas the providers are validated against, so a row
 * written by an older (or buggy) version can never reach the UI unvalidated.
 */
function toRecord(row: EvaluationRow): EvaluationRecord {
  const criteria = row.criteria
    .map((c) => criterionSchema.safeParse(c))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  const issues = row.issues
    .map((i) => evaluationIssueSchema.safeParse(i))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  const recommendedExercises = row.recommendedExercises
    .map((r) => recommendedExerciseSchema.safeParse(r))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));

  return {
    id: row.id,
    userId: row.userId,
    evaluationType: row.evaluationType,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    providerId: row.providerId,
    providerDisplayName: row.providerDisplayName,
    providerType: row.providerType,
    providerVersion: row.providerVersion,
    model: row.model,
    promptVersion: row.promptVersion,
    rubricVersion: row.rubricVersion,
    fallbackUsed: row.fallbackUsed,
    fallbackFrom: row.fallbackFrom,
    checkedByName: row.checkedByName,
    checkedBy: {
      id: row.providerId,
      displayName: row.providerDisplayName,
      type: row.providerType,
    },
    overallEstimate: row.overallEstimate,
    confidence: row.confidence,
    verdict: row.verdict,
    criteria,
    strengths: row.strengths,
    weaknesses: row.weaknesses,
    issues,
    nextActions: row.nextActions,
    recommendedExercises,
    processedInMs: row.processedInMs,
    createdAt: row.createdAt,
  };
}

export async function findEvaluation(params: {
  sourceType: string;
  sourceId: string;
}): Promise<EvaluationRecord | null> {
  const row = await db.query.evaluations.findFirst({
    where: and(eq(evaluations.sourceType, params.sourceType), eq(evaluations.sourceId, params.sourceId)),
  });
  return row ? toRecord(row) : null;
}

/**
 * Remove the evaluation attached to a source row that is being deleted.
 *
 * `sourceId` is polymorphic, so it cannot carry a foreign key and cannot rely on
 * a database cascade. Any code path that deletes a source it can have been
 * evaluated for must call this, otherwise an orphaned evaluation survives its
 * submission.
 */
export async function deleteEvaluationsForSource(params: {
  sourceType: string;
  sourceId: string;
}): Promise<void> {
  await db
    .delete(evaluations)
    .where(
      and(eq(evaluations.sourceType, params.sourceType), eq(evaluations.sourceId, params.sourceId))
    );
}

/** Batch lookup for list pages — one query for a whole page of attempts/submissions. */
export async function findEvaluationsForSources(params: {
  sourceType: string;
  sourceIds: string[];
}): Promise<Map<string, EvaluationRecord>> {
  if (params.sourceIds.length === 0) return new Map();
  const rows = await db.query.evaluations.findMany({
    where: and(
      eq(evaluations.sourceType, params.sourceType),
      inArray(evaluations.sourceId, params.sourceIds)
    ),
  });
  return new Map(rows.map((row) => [row.sourceId, toRecord(row)]));
}

export function listEvaluationsForUser(userId: string, limit = 20) {
  return db
    .select()
    .from(evaluations)
    .where(eq(evaluations.userId, userId))
    .orderBy(desc(evaluations.createdAt))
    .limit(limit);
}

const SEVERITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

function highestSeverity(issues: EvaluationIssue[]): "low" | "medium" | "high" {
  let best = "low";
  for (const issue of issues) {
    if ((SEVERITY_RANK[issue.severity] ?? 0) > (SEVERITY_RANK[best] ?? 0)) best = issue.severity;
  }
  return best as "low" | "medium" | "high";
}

/**
 * Feed one evaluation into the shared learner weakness memory.
 *
 * Both RIWI and any external evaluator write through this single function, so a
 * learner has one history — never one per provider. Categories the evaluation
 * genuinely checked but did not flag move forward in status; that is what makes
 * "what improved?" an answerable question instead of a guess.
 */
export async function recordWeaknessesFromEvaluation(params: {
  userId: string;
  evaluationType: EvaluationType;
  result: EvaluationResult;
}): Promise<void> {
  const { userId, evaluationType, result } = params;
  const checked = categoriesCheckedBy(evaluationType);

  const byCategory = new Map<WeaknessCategory, EvaluationIssue[]>();
  for (const issue of result.issues) {
    if (!isWeaknessCategory(issue.category)) continue;
    const list = byCategory.get(issue.category) ?? [];
    list.push(issue);
    byCategory.set(issue.category, list);
  }

  const now = new Date();

  for (const [category, issues] of byCategory) {
    const severity = highestSeverity(issues);
    await db
      .insert(coachWeaknesses)
      .values({
        userId,
        category,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrenceCount: issues.length,
        recentSeverity: severity,
        status: "open",
      })
      .onConflictDoUpdate({
        target: [coachWeaknesses.userId, coachWeaknesses.category],
        set: {
          lastSeenAt: now,
          occurrenceCount: sql`${coachWeaknesses.occurrenceCount} + ${issues.length}`,
          recentSeverity: severity,
          status: "open",
        },
      });
  }

  const clean = checked.filter((category) => !byCategory.has(category));
  if (clean.length > 0) {
    await db
      .update(coachWeaknesses)
      .set({
        // open → improving on the first clean pass, improving → resolved on the
        // second. A single good day never erases a pattern, and never hides one.
        status: sql`case
          when ${coachWeaknesses.status} = 'open' then 'improving'::weakness_status
          when ${coachWeaknesses.status} = 'improving' then 'resolved'::weakness_status
          else ${coachWeaknesses.status} end`,
        lastSeenAt: now,
      })
      .where(
        and(
          eq(coachWeaknesses.userId, userId),
          inArray(coachWeaknesses.category, clean),
          sql`${coachWeaknesses.occurrenceCount} > 0`
        )
      );
  }
}

export function listWeaknesses(userId: string) {
  return db
    .select()
    .from(coachWeaknesses)
    .where(eq(coachWeaknesses.userId, userId))
    .orderBy(desc(coachWeaknesses.lastSeenAt));
}

/** Audit trail for operators: which submission needed a fallback, and why. */
export async function recordFallbackEvent(params: {
  userId: string;
  evaluationType: EvaluationType;
  fallbackFrom: string;
  sourceId: string;
}): Promise<void> {
  await db.insert(activityEvents).values({
    userId: params.userId,
    type: "COACH_PROVIDER_FALLBACK",
    payload: {
      evaluationType: params.evaluationType,
      fallbackFrom: params.fallbackFrom,
      evaluatedBy: "riwi",
      sourceId: params.sourceId,
    },
  });
}

export async function recordEvaluationEvent(params: {
  userId: string;
  evaluationType: EvaluationType;
  providerId: string;
  sourceId: string;
  overallEstimate: number | null;
}): Promise<void> {
  await db.insert(activityEvents).values({
    userId: params.userId,
    type: "COACH_EVALUATION_COMPLETED",
    payload: {
      evaluationType: params.evaluationType,
      providerId: params.providerId,
      sourceId: params.sourceId,
      overallEstimate: params.overallEstimate,
    },
  });
}

/**
 * Insert the evaluation, or return the one that is already there.
 *
 * `onConflictDoNothing` + read-back is deliberately race-safe: two concurrent
 * submissions of the same source produce one row and both callers see the same
 * verdict, so a learner can never be shown two different evaluations of one
 * piece of work.
 */
export async function saveEvaluation(params: {
  userId: string;
  evaluationType: EvaluationType;
  sourceType: string;
  sourceId: string;
  result: EvaluationResult;
}): Promise<{ record: EvaluationRecord; created: boolean }> {
  const { result } = params;
  const existing = await findEvaluation({
    sourceType: params.sourceType,
    sourceId: params.sourceId,
  });
  if (existing) return { record: existing, created: false };

  const inserted = await db
    .insert(evaluations)
    .values({
      userId: params.userId,
      evaluationType: params.evaluationType,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      providerId: result.providerId,
      providerDisplayName: result.providerDisplayName,
      providerType: result.providerType,
      providerVersion: result.providerVersion,
      model: result.model,
      promptVersion: result.promptVersion,
      rubricVersion: result.rubricVersion,
      fallbackUsed: result.fallbackUsed,
      fallbackFrom: result.fallbackFrom,
      checkedByName: result.checkedBy.displayName,
      overallEstimate: result.overallEstimate,
      confidence: result.confidence,
      verdict: result.verdict,
      criteria: result.criteria,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      issues: result.issues,
      nextActions: result.nextActions,
      recommendedExercises: result.recommendedExercises,
      processedInMs: result.processedInMs,
    })
    .onConflictDoNothing({
      target: [evaluations.sourceType, evaluations.sourceId],
    })
    .returning();

  const row = inserted[0];
  if (row) return { record: toRecord(row), created: true };

  // Lost a race with a concurrent evaluation of the same source.
  const raced = await findEvaluation({ sourceType: params.sourceType, sourceId: params.sourceId });
  if (!raced) throw new Error("evaluation_write_failed");
  return { record: raced, created: false };
}
