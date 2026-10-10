import "server-only";
import { resolveEvaluation, type ResolveOutcome } from "@/lib/services/coach/resolver";
import type { WritingCheckInput } from "@/lib/services/coach/types";
import type { CoachConfig } from "@/lib/services/coach/config";
import { effectiveCoachConfig } from "@/lib/services/coach/owner-control";
import { db } from "@/db/client";
import { saveEvaluation } from "@/lib/data/evaluations";

export type CheckVerdict = "correct" | "acceptable" | "needs_revision";
export type CheckResult = {
  verdict: CheckVerdict;
  /** Criterion bands by key (0..9), only keys the check asked for. */
  bands: Record<string, number | null>;
  feedback: string | null;
  improved: string | null;
  fixes: string[];
  /** The resolver's evaluation id (for vocabulary usage evidence). */
  evaluationId: string | null;
};
export type CheckOutcome = { ok: true; result: CheckResult } | { ok: false; reason: "unavailable" | "failed" };

export const CHECK_CRITERIA: Record<WritingCheckInput["kind"], readonly string[]> = {
  translation: ["meaning", "grammar", "vocabulary"],
  activation: ["meaning", "form", "collocation", "naturalness", "grammar"],
  pattern: ["grammar", "meaning", "pattern", "adaptation"],
};

type Resolve = (...args: Parameters<typeof resolveEvaluation>) => Promise<ResolveOutcome>;

/**
 * One short external-AI check through the existing Coach resolver, with
 * fallback "none": RIWI is never asked, and anything that is not an external,
 * non-fallback result is discarded — so nothing rule-based is shown as AI.
 */
export async function runWritingCheck(userId: string, language: "uz" | "en", check: WritingCheckInput, deps: {
  resolve?: Resolve;
  control?: () => Promise<Partial<CoachConfig>>;
  /** Server-created Activation event identity, never supplied by the learner. */
  persist?: { sourceId: string; database: typeof db };
} = {}): Promise<CheckOutcome> {
  const resolve = deps.resolve ?? resolveEvaluation;
  let outcome: ResolveOutcome;
  try {
    // Owner master switch + deployment ceiling (server-side, fail-closed).
    const control = deps.control ? await deps.control() : await effectiveCoachConfig();
    outcome = await resolve(
      { evaluationType: "writing", input: { taskType: "task2", prompt: "", content: check.answer, targetWordCount: 0, check } },
      { userId, language }, { externalEnabled: control.externalEnabled, aiPrimaryProvider: control.aiPrimaryProvider, modelOverride: control.modelOverride ?? null }, { fallback: "none" },
    );
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (!outcome.ok) return { ok: false, reason: outcome.error === "external_required" ? "unavailable" : "failed" };
  const r = outcome.result;
  if (r.providerType !== "external" || r.fallbackUsed) return { ok: false, reason: "unavailable" };
  if (deps.persist) {
    if (check.kind !== "activation" || r.evaluationType !== "writing" || r.overallEstimate !== null
      || r.assessmentContractKey !== `writing.check.activation-${check.mode}` || r.verdict === null) {
      return { ok: false, reason: "failed" };
    }
    try {
      const { record } = await saveEvaluation({ userId, evaluationType: "writing",
        sourceType: "writing_activation", sourceId: deps.persist.sourceId, result: r,
      }, deps.persist.database);
      if (record.userId !== userId || record.evaluationType !== "writing"
        || record.providerType !== "external" || record.fallbackUsed
        || record.sourceType !== "writing_activation" || record.sourceId !== deps.persist.sourceId
        || record.overallEstimate !== null || record.assessmentContractKey !== r.assessmentContractKey) {
        return { ok: false, reason: "failed" };
      }
      return { ok: true, result: normalizeCheck(check.kind, { ...record, evaluationId: record.id }) };
    } catch {
      return { ok: false, reason: "failed" };
    }
  }
  return { ok: true, result: normalizeCheck(check.kind, r) };
}

type ResultLike = {
  evaluationId?: string;
  verdict?: string | null;
  criteria?: Array<{ key: string; band: number | null }>;
  weaknesses?: string[];
  nextActions?: string[];
  issues?: Array<{ message?: string; suggestion?: string | null }>;
};

export function normalizeCheck(kind: WritingCheckInput["kind"], r: ResultLike): CheckResult {
  const bands: Record<string, number | null> = {};
  for (const key of CHECK_CRITERIA[kind]) {
    const c = r.criteria?.find((x) => x.key.toLowerCase() === key);
    const b = c && typeof c.band === "number" && Number.isFinite(c.band) ? Math.min(9, Math.max(0, Math.round(c.band * 2) / 2)) : null;
    bands[key] = b;
  }
  let verdict: CheckVerdict = r.verdict === "correct" ? "correct" : r.verdict === "mostly_correct" ? "acceptable" : "needs_revision";
  // Server guard: a pattern answer that copies the source is never rewarded,
  // and a translation that loses the meaning is never "correct".
  if (kind === "pattern" && (bands.adaptation ?? 0) < 5) verdict = "needs_revision";
  if (kind === "translation" && (bands.meaning ?? 0) < 6) verdict = "needs_revision";
  const issues = r.issues ?? [];
  const fixes = [...(r.nextActions ?? []), ...(r.weaknesses ?? [])].filter(Boolean).slice(0, 3);
  return {
    verdict, bands,
    feedback: issues[0]?.message ?? r.weaknesses?.[0] ?? null,
    improved: issues.find((i) => i.suggestion)?.suggestion ?? null,
    fixes,
    evaluationId: r.evaluationId ?? null,
  };
}
