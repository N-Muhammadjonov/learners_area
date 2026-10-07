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
    const qs = await tx
      .select({ id: listeningQuestions.id })
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, a.testId));
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
  return NextResponse.json(result, {
    status: "error" in result ? 409 : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
