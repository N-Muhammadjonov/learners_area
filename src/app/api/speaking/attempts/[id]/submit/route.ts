import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { submitAttemptSchema } from "@/lib/validation/speaking-practice";

/**
 * POST /api/speaking/attempts/:id/submit — finalize a practice attempt.
 *
 * Requires a recording to actually be attached: an attempt with no audio is
 * not a submission. Transcribing it is a separate concern and only happens if
 * a real SpeechToTextService is configured — see
 * src/lib/services/speech-to-text (absent, deliberately).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const attempt = await db.query.speakingAttempts.findFirst({
    where: eq(speakingAttempts.id, params.id),
  });
  if (!attempt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (attempt.userId !== session.sub) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (attempt.status !== "recording") {
    return NextResponse.json({ error: "attempt_already_submitted" }, { status: 409 });
  }
  if (!attempt.recordingObjectKey) {
    return NextResponse.json({ error: "no_recording" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = submitAttemptSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [updated] = await db
    .update(speakingAttempts)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      ...(parsed.data.durationMs !== undefined ? { recordingDurationMs: parsed.data.durationMs } : {}),
    })
    .where(eq(speakingAttempts.id, params.id))
    .returning();

  return NextResponse.json({ ok: true, attempt: updated });
}
