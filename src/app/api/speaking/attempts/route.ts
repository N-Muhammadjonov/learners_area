import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts, speakingPrompts } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { createAttemptSchema } from "@/lib/validation/speaking-practice";

/**
 * POST /api/speaking/attempts — start a practice attempt.
 *
 * The row is created in `recording` state before any audio exists, so the
 * client has an attemptId to scope its upload-intent to. That is what keeps a
 * recording's object key inside `speaking/attempts/<attemptId>/` instead of an
 * anonymous `pending/` namespace.
 *
 * GET /api/speaking/attempts — the caller's own attempt history. A student
 * only ever sees their own; teachers and admins see everything (for review).
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createAttemptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });
  }
  const data = parsed.data;

  // A prompt must exist and be active; free practice (no prompt) is allowed.
  if (data.promptId) {
    const prompt = await db.query.speakingPrompts.findFirst({
      where: eq(speakingPrompts.id, data.promptId),
    });
    if (!prompt || !prompt.isActive) {
      return NextResponse.json({ error: "prompt_not_found" }, { status: 404 });
    }
  }

  // "Try again" lineage (§30). The retry target has to be the caller's OWN
  // submitted attempt: a client cannot attach its new work to someone else's
  // attempt, and cannot claim a retry of an attempt that was never submitted.
  // The referenced row is left untouched, so the original attempt and its
  // feedback remain in history exactly as they were.
  if (data.retryOfAttemptId) {
    const previous = await db.query.speakingAttempts.findFirst({
      where: eq(speakingAttempts.id, data.retryOfAttemptId),
    });
    if (!previous) return NextResponse.json({ error: "retry_of_not_found" }, { status: 404 });
    if (previous.userId !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (previous.status !== "submitted") {
      return NextResponse.json({ error: "retry_of_not_submitted" }, { status: 409 });
    }
  }

  const [created] = await db
    .insert(speakingAttempts)
    .values({
      userId: user.id,
      promptId: data.promptId ?? null,
      part: data.part,
      status: "recording",
      retryOfAttemptId: data.retryOfAttemptId ?? null,
    })
    .returning();

  return NextResponse.json({ ok: true, attempt: created });
}

export async function GET(_req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const isReviewer = isStaff(user.role);
  const rows = await db.query.speakingAttempts.findMany({
    where: isReviewer ? undefined : eq(speakingAttempts.userId, user.id),
    orderBy: [desc(speakingAttempts.startedAt)],
  });

  return NextResponse.json({ ok: true, attempts: rows });
}
