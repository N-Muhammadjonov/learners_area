import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAiSessionItems, speakingAiSessions, speakingAttempts } from "@/db/schema";
import { findEvaluationsForSources, type EvaluationRecord } from "./evaluations";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { validateAssessmentOutput } from "@/lib/services/coach/contracts/compose";
import { getAssessmentContract } from "@/lib/services/coach/contracts/registry";
import { providerEvaluationOutputSchema } from "@/lib/services/coach/schema";

const halfBand = (value: number) => Math.round(value * 2) / 2;
type Item = typeof speakingAiSessionItems.$inferSelect;
type Attempt = typeof speakingAttempts.$inferSelect;
type Session = typeof speakingAiSessions.$inferSelect;
const keys = ["fluency", "lexical", "grammar"] as const;
const labels = { fluency: "Fluency and Coherence", lexical: "Lexical Resource", grammar: "Grammatical Range and Accuracy" };

/** Aggregates only complete, grounded textual criteria linked to an accepted owned item. */
export function aggregateSpeakingSummary(session: Session, items: Item[], attempts: Attempt[], evaluations: Map<string, EvaluationRecord>) {
  const byId = new Map(attempts.map(attempt => [attempt.id, attempt]));
  const accepted: Array<{ attempt: Attempt; evaluation: EvaluationRecord }> = [];
  const durations = new Map<string, number>();
  const strengths = new Map<string, number>(); const weaknesses = new Map<string, number>(); const categories = new Map<string, number>();
  const values = new Map(keys.map(key => [key, [] as number[]]));
  for (const item of items) {
    if (item.sessionId !== session.id || item.status !== "answered" || !item.attemptId) continue;
    const attempt = byId.get(item.attemptId); const evaluation = evaluations.get(item.attemptId);
    if (!attempt || attempt.userId !== session.userId || attempt.aiSessionId !== session.id || attempt.aiSessionItemId !== item.id || attempt.promptId !== item.promptId || attempt.part !== item.part || !["submitted", "reviewed"].includes(attempt.status)) continue;
    if (attempt.recordingDurationMs !== null && Number.isFinite(attempt.recordingDurationMs) && attempt.recordingDurationMs >= 0 && attempt.recordingDurationMs <= 3_600_000) durations.set(attempt.id, attempt.recordingDurationMs);
    if (!evaluation || evaluation.userId !== session.userId || evaluation.sourceType !== "speaking_attempt" || evaluation.sourceId !== attempt.id || evaluation.evaluationType !== "speaking" || accepted.some(value => value.attempt.id === attempt.id)) continue;
    const contract = getAssessmentContract(`speaking.${attempt.part}`);
    if (!contract || (evaluation.assessmentContractKey != null && evaluation.assessmentContractKey !== contract.key)) continue;
    const parsed = providerEvaluationOutputSchema.safeParse({
      overallEstimate: evaluation.overallEstimate, confidence: evaluation.confidence, verdict: evaluation.verdict,
      criteria: evaluation.criteria, strengths: evaluation.strengths, weaknesses: evaluation.weaknesses,
      issues: evaluation.issues, nextActions: evaluation.nextActions, recommendedExercises: evaluation.recommendedExercises,
      ...(evaluation.teachingFeedback ? { teachingFeedback: evaluation.teachingFeedback } : {}),
    });
    if (!parsed.success || !validateAssessmentOutput(contract, "speaking", { part: attempt.part, transcript: attempt.transcript }, parsed.data)) continue;
    const measured = evaluation.criteria.filter(criterion => criterion.key !== "pronunciation");
    if (measured.length !== 3 || keys.some(key => measured.filter(criterion => criterion.key === key && criterion.limited !== true && criterion.band !== null && Number.isFinite(criterion.band) && criterion.band >= 0 && criterion.band <= 9 && criterion.band * 2 === Math.round(criterion.band * 2)).length !== 1)) continue;
    accepted.push({ attempt, evaluation });
    for (const key of keys) values.get(key)!.push(measured.find(criterion => criterion.key === key)!.band!);
    for (const value of new Set(evaluation.strengths)) strengths.set(value, (strengths.get(value) ?? 0) + 1);
    for (const value of new Set(evaluation.weaknesses)) weaknesses.set(value, (weaknesses.get(value) ?? 0) + 1);
    // Recurrence is across answers, not several mentions inside one answer.
    for (const category of new Set(evaluation.issues.map(issue => issue.category))) categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const answered = items.filter(item => item.sessionId === session.id && item.status === "answered").length;
  const skipped = items.filter(item => item.sessionId === session.id && item.status === "skipped").length;
  const criteria = keys.flatMap(key => values.get(key)!.length ? [{ key, label: labels[key], estimate: halfBand(values.get(key)!.reduce((sum, band) => sum + band, 0) / values.get(key)!.length), evidenceCount: values.get(key)!.length }] : []);
  const completeEvidence = session.status === "completed" && answered > 0 && skipped === 0 && accepted.length === answered && answered === items.length && session.limitations.length === 0;
  const top = (map: Map<string, number>) => [...map].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,3).map(([text]) => text);
  return { checkedBy: PUBLIC_CHECKED_BY, mode: session.mode, answered, skipped, evaluated: accepted.length, unevaluated: answered - accepted.length, completeEvidence,
    totalDurationMs: [...durations.values()].reduce((sum, duration) => sum + duration, 0),
    textBasedEstimate: completeEvidence && criteria.length === 3 ? halfBand(criteria.reduce((sum, value) => sum + value.estimate,0)/3) : null,
    criteria, strengths: top(strengths), weaknesses: top(weaknesses),
    recurringWeaknesses: [...categories].filter(([, count]) => count >= 2).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(([category,count])=>({category,count})),
    pronunciation: { assessed: false, band: null }, limitations: session.limitations,
  };
}

export async function readSpeakingSummary(database: typeof db, userId: string, id: string) {
  const session = await database.query.speakingAiSessions.findFirst({ where: and(eq(speakingAiSessions.id,id), eq(speakingAiSessions.userId,userId)) });
  if (!session) return { ok: false as const, error: "not_found", status: 404 };
  if (session.status !== "completed") return { ok: false as const, error: "session_not_completed", status: 409 };
  const items = await database.select().from(speakingAiSessionItems).where(eq(speakingAiSessionItems.sessionId,id)).orderBy(speakingAiSessionItems.ordinal);
  const ids = items.filter(item=>item.status === "answered").flatMap(item=>item.attemptId ? [item.attemptId] : []);
  const attempts = ids.length ? await database.query.speakingAttempts.findMany({ where: and(inArray(speakingAttempts.id,ids),eq(speakingAttempts.userId,userId)) }) : [];
  const evaluations = await findEvaluationsForSources({sourceType:"speaking_attempt",sourceIds:ids}, database);
  return { ok: true as const, summary: aggregateSpeakingSummary(session,items,attempts,evaluations) };
}
