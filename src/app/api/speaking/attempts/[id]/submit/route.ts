import { learnerSpeakingAttempt } from "@/lib/speaking/attempt-projection";
import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { db } from "@/db/client";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { submitAttemptSchema } from "@/lib/validation/speaking-practice";
import { type EvaluationRecord } from "@/lib/data/evaluations";

import { submitSpeakingAttempt } from "@/lib/data/speaking-submission";

/** Learner-safe projection: real provider/model provenance stays in the internal evaluation row. */
function learnerEvaluation(evaluation: EvaluationRecord | null) {
  if (!evaluation) return null;
  return {
    id: evaluation.id,
    checkedBy: PUBLIC_CHECKED_BY,
    fallbackUsed: evaluation.fallbackUsed,
    overallEstimate: evaluation.overallEstimate,
    verdict: evaluation.verdict,
    confidence: evaluation.confidence,
    criteria: evaluation.criteria,
    strengths: evaluation.strengths.slice(0, 3),
    weaknesses: evaluation.weaknesses.slice(0, 3),
    issues: evaluation.issues.slice(0, 3),
    nextActions: evaluation.nextActions.slice(0, 1),
    teachingFeedback: evaluation.teachingFeedback ?? null,
  };
}

/**
 * Explicit finalization boundary. Stop never calls this route: only the review
 * screen's “Send to RIWI” action supplies a reviewed browser transcript.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = submitAttemptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await submitSpeakingAttempt(db, user.id, id, parsed.data, await getLocale());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, attempt: learnerSpeakingAttempt(result.attempt), reused: result.reused,
    transcriptOrigin: result.attempt.transcriptOrigin, transcriptEdited: result.attempt.transcriptEdited,
    evaluated: Boolean(result.evaluation), evaluation: learnerEvaluation(result.evaluation) });
}
