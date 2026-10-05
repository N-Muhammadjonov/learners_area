import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { speakingAiSessionItems, speakingAiSessions, speakingAttempts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answered"), attemptId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("skipped") }).strict(),
]);

/** Ownership-checked, idempotent advancement of exactly one immutable plan item. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  if (!isUuid(id) || !isUuid(itemId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const session = await db.query.speakingAiSessions.findFirst({ where: and(eq(speakingAiSessions.id, id), eq(speakingAiSessions.userId, user.id)) });
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (session.status !== "active") return NextResponse.json({ error: "session_not_active" }, { status: 409 });
  const item = await db.query.speakingAiSessionItems.findFirst({ where: and(eq(speakingAiSessionItems.id, itemId), eq(speakingAiSessionItems.sessionId, id)) });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (item.ordinal !== session.currentItemIndex + 1) {
    if (item.status !== "pending") return NextResponse.json({ ok: true, item, currentItemIndex: session.currentItemIndex, reused: true });
    return NextResponse.json({ error: "stale_session_position" }, { status: 409 });
  }

  let attemptId: string | null = null;
  if (parsed.data.action === "answered") {
    const attempt = await db.query.speakingAttempts.findFirst({ where: and(eq(speakingAttempts.id, parsed.data.attemptId), eq(speakingAttempts.userId, user.id)) });
    if (!attempt || attempt.status === "recording" || attempt.promptId !== item.promptId || attempt.aiSessionId !== id || attempt.aiSessionItemId !== itemId) {
      return NextResponse.json({ error: "invalid_attempt" }, { status: 409 });
    }
    attemptId = attempt.id;
  }

  const result = await db.transaction(async (tx) => {
    const [updatedItem] = await tx.update(speakingAiSessionItems).set({ status: parsed.data.action, attemptId })
      .where(and(eq(speakingAiSessionItems.id, item.id), eq(speakingAiSessionItems.status, "pending"))).returning();
    if (!updatedItem) return { item, session };
    const total = await tx.$count(speakingAiSessionItems, eq(speakingAiSessionItems.sessionId, id));
    const completed = item.ordinal >= total;
    const [updatedSession] = await tx.update(speakingAiSessions).set({
      currentItemIndex: item.ordinal,
      ...(completed ? { status: "completed", completedAt: new Date() } : {}),
    }).where(and(eq(speakingAiSessions.id, id), eq(speakingAiSessions.currentItemIndex, session.currentItemIndex))).returning();
    return { item: updatedItem, session: updatedSession ?? session };
  });
  return NextResponse.json({ ok: true, ...result });
}
