import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { submitAttemptSchema } from "@/lib/validation/speaking-practice";
import { resolveBrowserTranscript } from "@/lib/speaking/browser-transcript";
import { evaluateSpeakingAttempt, transcribePrivateRecording } from "@/lib/services/coach";
import { toLearnerEvaluation, type LearnerEvaluation } from "@/lib/services/coach/public-evaluation";
import type { TranscriptOrigin } from "@/lib/services/coach/types";

/**
 * POST /api/speaking/attempts/:id/submit — finalize a practice attempt.
 *
 * Transcript policy, in order of preference:
 *   1. The student's own browser SpeechRecognition, reviewed and sent by them
 *      (`browserTranscript`), stored with origin="browser_stt" — the Practice
 *      with AI path (§13–§18). Costs no STT API call, because the recognition
 *      ran in the learner's own browser.
 *   2. The student typed their own transcript (`manualTranscript`), which is
 *      stored with origin="manual" and labelled as such everywhere it appears.
 *   3. A configured SpeechToTextService transcribes the private recording.
 *   4. No transcript. The attempt is still submitted and playable, and the
 *      Coach reports that there is nothing to evaluate — RIWI never invents a
 *      transcript, and it cannot judge audio directly.
 *
 * 2 and 3 keep the relative order this route has always had; the browser path is
 * added ahead of them because it is an explicit, reviewed learner action.
 *
 * A `transcript` or `transcriptOrigin` field is deliberately NOT accepted: the
 * schema is `.strict()`, so sending either is a 400. Origin is derived here from
 * which path actually produced the text, which is what keeps a client from
 * labelling its own fabrication as machine transcription (§43).
 *
 * The learner response is projected through `toLearnerEvaluation`, so the real
 * provider/model identity stored on the row can never reach a learner surface.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  // The learner's reviewed browser transcript, if this request carries one. Both
  // strings are needed: the raw one is the audit trail, and comparing them is how
  // "the learner edited this" is derived rather than asserted (§14).
  const browser = resolveBrowserTranscript({
    raw: parsed.data.browserTranscriptRaw,
    final: parsed.data.browserTranscript,
  });

  let transcript: string | null = null;
  let transcriptOrigin: TranscriptOrigin | null = null;
  let transcriptProvider: string | null = null;
  let transcriptRaw: string | null = null;
  let transcriptEdited = false;

  if (browser) {
    transcript = browser.transcript;
    transcriptOrigin = "browser_stt";
    transcriptRaw = browser.raw;
    transcriptEdited = browser.edited;
  } else if (manualTranscript.length >= 10) {
    transcript = manualTranscript;
    transcriptOrigin = "manual";
  } else {
    // Try the configured transcriber. Failure is not fatal: the recording is
    // still a valid submission, it just has no automated feedback.
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

  const [updated] = await db
    .update(speakingAttempts)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      ...(parsed.data.durationMs !== undefined ? { recordingDurationMs: parsed.data.durationMs } : {}),
      ...(transcript ? { transcript, transcriptOrigin, transcriptProvider } : {}),
      // Only the browser path has a raw/edited distinction to record. Storing the
      // unedited recognition output alongside the sent text is what makes
      // "transcript_edited = true" verifiable later instead of merely claimed.
      ...(transcriptRaw !== null
        ? {
            transcriptRaw,
            transcriptEdited,
            ...(transcriptEdited ? { transcriptEditedAt: new Date() } : {}),
          }
        : {}),
    })
    .where(eq(speakingAttempts.id, id))
    .returning();

  let evaluation: LearnerEvaluation | null = null;

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
      transcriptEdited,
      durationMs: parsed.data.durationMs ?? attempt.recordingDurationMs ?? null,
      language: await getLocale(),
    });

    // An evaluation failure after a successful submit is not an error the
    // student caused, and their recording is already safely stored: report it
    // rather than pretending feedback exists.
    if (outcome.ok) {
      evaluation = toLearnerEvaluation(outcome.evaluation);
    }
  }

  return NextResponse.json({
    ok: true,
    attempt: updated,
    transcriptOrigin,
    transcriptEdited,
    evaluated: evaluation !== null,
    evaluation,
  });
}
