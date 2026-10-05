import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAiSessionItems, speakingAiSessions, speakingAttempts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { findEvaluationsForSources } from "@/lib/data/evaluations";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";

const halfBand = (value: number) => Math.round(value * 2) / 2;

/** Deterministic aggregation over accepted persisted evaluations; no model invents a session number. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const session = await db.query.speakingAiSessions.findFirst({ where: and(eq(speakingAiSessions.id, id), eq(speakingAiSessions.userId, user.id)) });
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (session.status !== "completed") return NextResponse.json({ error: "session_not_completed" }, { status: 409 });

  const items = await db.select().from(speakingAiSessionItems).where(eq(speakingAiSessionItems.sessionId, id));
  const attemptIds = items.map((item) => item.attemptId).filter((value): value is string => Boolean(value));
  const attempts = attemptIds.length ? await db.query.speakingAttempts.findMany({ where: inArray(speakingAttempts.id, attemptIds) }) : [];
  const evaluations = await findEvaluationsForSources({ sourceType: "speaking_attempt", sourceIds: attemptIds });
  const criteria = new Map<string, { label: string; values: number[] }>();
  const strengths = new Map<string, number>();
  const weaknesses = new Map<string, number>();
  const issueCategories = new Map<string, number>();
  for (const evaluation of evaluations.values()) {
    for (const criterion of evaluation.criteria) {
      if (criterion.limited || criterion.band === null || criterion.key === "pronunciation") continue;
      const entry = criteria.get(criterion.key) ?? { label: criterion.label, values: [] };
      entry.values.push(criterion.band); criteria.set(criterion.key, entry);
    }
    for (const value of evaluation.strengths) strengths.set(value, (strengths.get(value) ?? 0) + 1);
    for (const value of evaluation.weaknesses) weaknesses.set(value, (weaknesses.get(value) ?? 0) + 1);
    for (const issue of evaluation.issues) issueCategories.set(issue.category, (issueCategories.get(issue.category) ?? 0) + 1);
  }
  const criterionResults = [...criteria.entries()].map(([key, value]) => ({
    key, label: value.label, estimate: halfBand(value.values.reduce((sum, band) => sum + band, 0) / value.values.length), evidenceCount: value.values.length,
  }));
  const overall = criterionResults.length ? halfBand(criterionResults.reduce((sum, value) => sum + value.estimate, 0) / criterionResults.length) : null;
  const top = (values: Map<string, number>) => [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([message]) => message);

  return NextResponse.json({ ok: true, summary: {
    checkedBy: PUBLIC_CHECKED_BY,
    mode: session.mode,
    answered: items.filter((item) => item.status === "answered").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    totalDurationMs: attempts.reduce((sum, attempt) => sum + (attempt.recordingDurationMs ?? 0), 0),
    textBasedEstimate: overall,
    criteria: criterionResults,
    strengths: top(strengths),
    weaknesses: top(weaknesses),
    recurringWeaknesses: [...issueCategories.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count })),
    pronunciation: { assessed: false, band: null },
  }});
}
