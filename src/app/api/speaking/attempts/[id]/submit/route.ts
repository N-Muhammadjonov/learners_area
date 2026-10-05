import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { submitAttemptSchema } from "@/lib/validation/speaking-practice";
import { evaluateSpeakingAttempt, transcribePrivateRecording } from "@/lib/services/coach";
import { findEvaluation, type EvaluationRecord } from "@/lib/data/evaluations";

type TranscriptOrigin = "stt" | "manual" | "browser_stt";

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

  const attempt = await db.query.speakingAttempts.findFirst({ where: and(eq(speakingAttempts.id, id), eq(speakingAttempts.userId, user.id)) });
  if (!attempt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // API-level idempotency: a retry after a lost response resolves to the stored result.
  if (attempt.status !== "recording") {
    const existing = await findEvaluation({ sourceType: "speaking_attempt", sourceId: attempt.id });
    return NextResponse.json({ ok: true, reused: true, attempt, transcriptOrigin: attempt.transcriptOrigin, evaluated: Boolean(existing), evaluation: learnerEvaluation(existing) });
  }
  if (!attempt.recordingObjectKey) return NextResponse.json({ error: "no_recording" }, { status: 409 });

  const parsed = submitAttemptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  let transcript: string | null = null;
  let transcriptOrigin: TranscriptOrigin | null = null;
  let transcriptProvider: string | null = null;
  let transcriptRaw: string | null = null;
  let transcriptEdited = false;

  if (parsed.data.browserTranscript) {
    // User-side SpeechRecognition is accepted as learner-submitted text, never privileged machine truth.
    transcript = parsed.data.browserTranscript.trim();
    transcriptRaw = (parsed.data.browserTranscriptRaw ?? parsed.data.browserTranscript).trim();
    transcriptOrigin = "browser_stt";
    transcriptEdited = Boolean(parsed.data.browserTranscriptEdited) || transcript !== transcriptRaw;
  } else if (parsed.data.manualTranscript) {
    transcript = parsed.data.manualTranscript.trim();
    transcriptOrigin = "manual";
  } else {
    const speech = await transcribePrivateRecording({
      objectKey: attempt.recordingObjectKey,
      contentType: attempt.recordingMimeType,
      durationMs: parsed.data.durationMs ?? attempt.recordingDurationMs,
      language: await getLocale(),
    });
    if (speech.ok) {
      transcript = speech.transcript;
      transcriptOrigin = "stt";
      transcriptProvider = speech.providerId;
    }
  }

  const [updated] = await db.update(speakingAttempts).set({
    status: "submitted",
    submittedAt: new Date(),
    ...(parsed.data.durationMs !== undefined ? { recordingDurationMs: parsed.data.durationMs } : {}),
    ...(transcript ? {
      transcript,
      transcriptOrigin,
      transcriptProvider,
      transcriptRaw,
      transcriptEdited,
      transcriptEditedAt: transcriptEdited ? new Date() : null,
    } : {}),
  }).where(and(eq(speakingAttempts.id, id), eq(speakingAttempts.status, "recording"))).returning();

  // A concurrent request won the state transition. Return its single persisted result.
  if (!updated) {
    const current = await db.query.speakingAttempts.findFirst({ where: eq(speakingAttempts.id, id) });
    const existing = await findEvaluation({ sourceType: "speaking_attempt", sourceId: id });
    if (current?.transcript && !existing) return NextResponse.json({ error: "evaluation_in_progress" }, { status: 409 });
    return NextResponse.json({ ok: true, reused: true, attempt: current, evaluated: Boolean(existing), evaluation: learnerEvaluation(existing) });
  }

  let evaluation: EvaluationRecord | null = null;
  if (transcript) {
    const prompt = attempt.promptId
      ? await db.query.speakingPrompts.findFirst({ where: (p, { eq: eqOp }) => eqOp(p.id, attempt.promptId!) })
      : null;
    const outcome = await evaluateSpeakingAttempt({
      userId: user.id,
      attemptId: attempt.id,
      part: attempt.part,
      promptText: prompt?.promptText ?? null,
      transcript,
      transcriptOrigin,
      durationMs: parsed.data.durationMs ?? attempt.recordingDurationMs ?? null,
      language: await getLocale(),
    });
    if (outcome.ok) evaluation = outcome.evaluation;
  }

  return NextResponse.json({
    ok: true,
    attempt: updated,
    transcriptOrigin,
    transcriptEdited,
    evaluated: evaluation !== null,
    evaluation: learnerEvaluation(evaluation),
  });
}
