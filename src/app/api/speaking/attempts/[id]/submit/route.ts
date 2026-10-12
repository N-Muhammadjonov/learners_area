import { withUploadErrorBoundary } from "@/lib/uploads/server-errors";
import { saveSpeakingSubmission } from "@/lib/services/speaking/submission";
import type { ServiceError } from "@/lib/services/coach";
import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { submitAttemptSchema } from "@/lib/validation/speaking-practice";
import { evaluateSpeakingAttempt } from "@/lib/services/coach";

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
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withUploadErrorBoundary("speaking_submit", () => submit(req, params));
}

async function submit(req: NextRequest, params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const attempt = await db.query.speakingAttempts.findFirst({
    where: eq(speakingAttempts.id, id),
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

  const { attempt: updated, transcript, transcriptOrigin, transcriptionFailure } = await saveSpeakingSubmission({
    attempt,
    durationMs: parsed.data.durationMs,
    manualTranscript,
    language: await getLocale(),
  });
  let evaluationError: ServiceError | null = null;

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
      language: await getLocale(),
    });

    // An evaluation failure after a successful submit is not an error the
    // student caused, and their recording is already safely stored: report it
    // rather than pretending feedback exists.
    if (outcome.ok) {
      evaluation = {
        id: outcome.evaluation.id,
        checkedBy: PUBLIC_CHECKED_BY,
        fallbackUsed: outcome.evaluation.fallbackUsed,
        overallEstimate: outcome.evaluation.overallEstimate,
        verdict: outcome.evaluation.verdict,
      };
    } else {
      evaluationError = outcome.error;
    }
  }

  return NextResponse.json({
    ok: true,
    attempt: updated,
    transcriptOrigin,
    transcriptionFailure,
    evaluationError,
    recordingSaved: true,
    evaluated: evaluation !== null,
    evaluation,
  });
}
