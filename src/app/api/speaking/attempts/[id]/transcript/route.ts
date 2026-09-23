import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { speakingAttempts, speakingPrompts } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { evaluateSpeakingAttempt } from "@/lib/services/coach";

/**
 * POST /api/speaking/attempts/:id/transcript
 *
 * Lets a student add their own transcript to an attempt after recording it, so
 * a Speaking recording can be evaluated today, with no speech-to-text vendor
 * configured. The transcript is stored with origin="manual"; nothing in the UI
 * presents it as machine transcription, and the evaluation says the same.
 *
 * The field is named `manualTranscript`, not `transcript`, on purpose: a
 * `transcript` in a request body would be indistinguishable from real
 * transcription, and that distinction has to survive in the API.
 */
const schema = z.object({ manualTranscript: z.string().min(10).max(8000) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const attempt = await db.query.speakingAttempts.findFirst({
    where: eq(speakingAttempts.id, params.id),
  });
  if (!attempt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (attempt.userId !== session.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const prompt = attempt.promptId
    ? await db.query.speakingPrompts.findFirst({ where: eq(speakingPrompts.id, attempt.promptId) })
    : null;

  const outcome = await evaluateSpeakingAttempt({
    userId: session.sub,
    attemptId: attempt.id,
    part: attempt.part,
    promptText: prompt?.promptText ?? null,
    transcript: parsed.data.manualTranscript,
    transcriptOrigin: "manual",
    durationMs: attempt.recordingDurationMs,
    language: getLocale(),
  });

  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 502 });

  // Only persist the transcript once it produced an evaluation, but reuse the
  // one the service already produced rather than re-running the provider.
  await db
    .update(speakingAttempts)
    .set({
      transcript: parsed.data.manualTranscript,
      transcriptOrigin: "manual",
      transcriptProvider: null,
    })
    .where(eq(speakingAttempts.id, attempt.id));

  return NextResponse.json({
    ok: true,
    evaluationId: outcome.evaluation.id,
    checkedBy: outcome.evaluation.checkedBy.displayName,
    reused: outcome.reused,
  });
}
