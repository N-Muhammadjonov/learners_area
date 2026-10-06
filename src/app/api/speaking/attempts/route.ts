import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { startSpeakingAttempt } from "@/lib/services/speaking/attempts";
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

  // The service owns the identity rules: the prompt must exist, must be LIVE for
  // learners, must match the declared part, and the attempt records the exact revision
  // it answered (§5). Free practice (no prompt) stays free.
  const started = await startSpeakingAttempt({ actorId: user.id, promptId: data.promptId ?? null, part: data.part });

  if (!started.ok) {
    const status = started.reason === "prompt_not_found" ? 404 : 422;
    return NextResponse.json({ error: started.reason }, { status });
  }

  return NextResponse.json({
    ok: true,
    attempt: started.attempt,
    // The client is told whether its attempt is bound to a revision, so it never
    // implies a pinned prompt it does not have.
    binding: started.binding,
    contentVersionId: started.contentVersionId,
  });
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
