import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { submitAttemptSchema } from "@/lib/validation/speaking-practice";
import { evaluateSpeakingAttempt, transcribePrivateRecording } from "@/lib/services/coach";

/**
 * POST /api/speaking/attempts/:id/submit — finalize a practice attempt.
 *
 * Transcript policy, in order of preference:
 *   1. A configured SpeechToTextService transcribes the private recording.
 *   2. The student typed their own transcript (`manualTranscript`), which is
 *      stored with origin="manual" and labelled as such everywhere it appears.
 *   3. No transcript. The attempt is still submitted and playable, and the
 *      Coach reports that there is nothing to evaluate — RIWI never invents a
 *      transcript, and it cannot judge audio directly.
 *
 * A `transcript` field is deliberately NOT accepted: it would let a client
 * fabricate machine transcription.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const attempt = await db.query.speakingAttempts.findFirst({
    where: eq(speakingAttempts.id, params.id),
  });
  if (!attempt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (attempt.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (attempt.status !== "recording") {
    return NextResponse.json({ error: "attempt_already_submitted" }, { status: 409 });
  }
  if (!attempt.recordingObjectKey) {
    return NextResponse.json({ error: "no_recording" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = submitAttemptSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const manualTranscript =
    typeof (body as { manualTranscript?: unknown } | null)?.manualTranscript === "string"
      ? ((body as { manualTranscript: string }).manualTranscript.trim().slice(0, 8000))
      : "";

  let transcript: string | null = null;
  let transcriptOrigin: "stt" | "manual" | null = null;
  let transcriptProvider: string | null = null;

  if (manualTranscript.length >= 10) {
    transcript = manualTranscript;
    transcriptOrigin = "manual";
  } else {
    // Try the configured transcriber. Failure is not fatal: the recording is
    // still a valid submission, it just has no automated feedback.
    const speech = await transcribePrivateRecording({
      objectKey: attempt.recordingObjectKey,
      contentType: attempt.recordingMimeType,
      durationMs: parsed.data.durationMs ?? attempt.recordingDurationMs,
      language: getLocale(),
    });
    if (speech.ok) {
      transcript = speech.transcript;
      transcriptOrigin = "stt";
      transcriptProvider = speech.providerId;
    }
  }

  const [updated] = await db
    .update(speakingAttempts)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      ...(parsed.data.durationMs !== undefined ? { recordingDurationMs: parsed.data.durationMs } : {}),
      ...(transcript ? { transcript, transcriptOrigin, transcriptProvider } : {}),
    })
    .where(eq(speakingAttempts.id, params.id))
    .returning();

  let evaluation:
    | { id: string; checkedBy: string; fallbackUsed: boolean; overallEstimate: number | null; verdict: string | null }
    | null = null;

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
      language: getLocale(),
    });

    // An evaluation failure after a successful submit is not an error the
    // student caused, and their recording is already safely stored: report it
    // rather than pretending feedback exists.
    if (outcome.ok) {
      evaluation = {
        id: outcome.evaluation.id,
        checkedBy: outcome.evaluation.checkedBy.displayName,
        fallbackUsed: outcome.evaluation.fallbackUsed,
        overallEstimate: outcome.evaluation.overallEstimate,
        verdict: outcome.evaluation.verdict,
      };
    }
  }

  return NextResponse.json({
    ok: true,
    attempt: updated,
    transcriptOrigin,
    evaluated: evaluation !== null,
    evaluation,
  });
}
