import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  listeningAttempts,
  listeningDrafts,
  listeningPackages,
  listeningQuestions,
} from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { listeningQuestionsForAttempt } from "@/lib/listening/question-set";
const schema = z.object({
  answers: z.record(z.string().uuid(), z.string().max(500)),
  audioPosition: z.number().min(0).max(7200),
  startAudio: z.boolean().optional(),
});
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await db.transaction(async (tx) => {
    const [a] = await tx
      .select()
      .from(listeningAttempts)
      .where(
        and(
          eq(listeningAttempts.id, id),
          eq(listeningAttempts.userId, user.id),
        ),
      )
      .for("update");
    if (!a) return { error: "not_found" };
    if (a.status !== "in_progress") return { error: "already_submitted" };
    /*
     * A section the centre authored through the CMS has NO canonical package: its identity
     * comes from its revision and its questions from the canonical rows (that is how the
     * General catalogue lists it and how the attempt renders it). Saving an answer in
     * progress must therefore not depend on a package either — otherwise the learner's work
     * survives only in their own browser, and a section authored today behaves differently
     * from an imported one. The canonical rows are the authority in both cases; the authored
     * recording length is used when the package states one, and otherwise the schema's own
     * bound is the only honest limit.
     */
    const pkg = await tx.query.listeningPackages.findFirst({
      where: eq(listeningPackages.testId, a.testId),
    });
    const authoredDuration = pkg?.payload.audio.durationSec;
    if (typeof authoredDuration === "number" && parsed.data.audioPosition > authoredDuration)
      return { error: "invalid_input" };
    const qs = await listeningQuestionsForAttempt(a, tx as never);
    const allowed = new Set(qs.map((q) => q.id));
    if (Object.keys(parsed.data.answers).some((id) => !allowed.has(id)))
      return { error: "invalid_input" };
    const old = await tx.query.listeningDrafts.findFirst({
      where: eq(listeningDrafts.attemptId, id),
    });
    const started =
      old?.audioStartedAt ?? (parsed.data.startAudio ? new Date() : null);
    await tx
      .insert(listeningDrafts)
      .values({
        attemptId: id,
        answers: parsed.data.answers,
        audioPosition: parsed.data.audioPosition,
        audioStartedAt: started,
      })
      .onConflictDoUpdate({
        target: listeningDrafts.attemptId,
        set: {
          answers: parsed.data.answers,
          audioPosition: Math.max(
            old?.audioPosition ?? 0,
            parsed.data.audioPosition,
          ),
          audioStartedAt: started,
          updatedAt: new Date(),
        },
      });
    return { ok: true };
  });
  // Report the status that matches what actually happened.
  //
  // This used to collapse every failure into 409 Conflict. The dominant failure here is
  // "this attempt does not exist, or it is not yours" — the ownership check at line 39 returns
  // `not_found` for both, deliberately, so that a non-owner cannot tell an existing attempt from
  // a nonexistent one. Answering that with 409 is a privacy-safe status that still says the wrong
  // thing: a client, a monitor and an audit all read "conflict" where the truth is "not here".
  //
  // The reading sibling (`/api/reading/attempts/[id]`) already maps not_found → 404 and
  // invalid_input → 400; this brings the two in line instead of leaving one route guessing.
  // The only caller (NativeListeningExam) branches on `res.ok`, so no client behaviour changes.
  return NextResponse.json(result, {
    status:
      "error" in result
        ? result.error === "not_found"
          ? 404
          : result.error === "invalid_input"
            ? 400
            : 409
        : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
