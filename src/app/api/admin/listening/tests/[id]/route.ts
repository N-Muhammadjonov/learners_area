import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdministrator } from "@/lib/auth/current-user";
import { db } from "@/db/client";
import { listeningActivityRuns, listeningAttempts, listeningMcqSessions, listeningTests, resourceBlocks } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
const titleSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
async function update(req: NextRequest, params: Promise<{ id: string }>, archive: boolean) {
  const user = await requireAdministrator();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = archive ? null : titleSchema.safeParse(await req.json().catch(() => null));
  if (!archive && !parsed?.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const updated = await db.transaction(async tx => {
    const [current] = await tx.select().from(listeningTests).where(eq(listeningTests.id, id)).for("update");
    if (!current) return false;
    await tx.update(listeningTests).set(archive ? { publicationState: "archived", isActive: false, publishAt: null } : { title: parsed!.success ? parsed!.data.title : current.title }).where(eq(listeningTests.id, id));
    await recordAudit({ actorUserId: user.id, action: "content.updated", targetType: "listening", targetId: id, metadata: { operation: archive ? "archive" : "rename" } }, tx);
    return true;
  });
  return NextResponse.json(updated ? { ok: true } : { error: "not_found" }, { status: updated ? 200 : 404, headers: { "Cache-Control": "private, no-store" } });
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return update(req, params, false); }
/**
 * DELETE means DELETE. Do not silently archive under a destructive label:
 * archived source IDs stayed unique, so the owner could never import again.
 * Refuse destructive deletion when attempts or study/MCQ runs exist.
 * Nothing in the transaction is deleted on that 409 path.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdministrator();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const outcome = await db.transaction(async tx => {
      const [current] = await tx.select({ id: listeningTests.id }).from(listeningTests)
        .where(eq(listeningTests.id, id)).for("update");
      if (!current) return "not_found" as const;
      const [attempt, activity, mcq] = await Promise.all([
        tx.select({ id: listeningAttempts.id }).from(listeningAttempts).where(eq(listeningAttempts.testId, id)).limit(1),
        tx.select({ id: listeningActivityRuns.id }).from(listeningActivityRuns).where(eq(listeningActivityRuns.testId, id)).limit(1),
        tx.select({ id: listeningMcqSessions.id }).from(listeningMcqSessions).where(eq(listeningMcqSessions.testId, id)).limit(1),
      ]);
      if (attempt.length || activity.length || mcq.length) return "has_learner_history" as const;
      // Remove generic owner references; the actual R2 media remains managed by
      // the separate, reference-aware storage lifecycle, never by an unsafe
      // delete of a potentially shared object key.
      await tx.delete(resourceBlocks).where(and(eq(resourceBlocks.ownerType, "listening"), eq(resourceBlocks.ownerId, id)));
      await recordAudit({
        actorUserId: admin.id, action: "content.updated", targetType: "listening", targetId: id,
        metadata: { operation: "permanent_delete", noLearnerHistory: true },
      }, tx);
      await tx.delete(listeningTests).where(eq(listeningTests.id, id));
      return "deleted" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: outcome }, { status: 404 });
    if (outcome === "has_learner_history") return NextResponse.json({ error: outcome, detail: "Learner attempts or activity history must be preserved. Archive this test instead." }, { status: 409 });
    return NextResponse.json({ ok: true, action: outcome }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // Other foreign-key references are a reason to refuse destruction, not a
    // reason to cascade away unknown user records.
    return NextResponse.json({ error: "delete_blocked_by_references" }, { status: 409 });
  }
}
