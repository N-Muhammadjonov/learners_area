import { learnerSpeakingAttempt } from "@/lib/speaking/attempt-projection";
import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAttempts } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { discardSpeakingAttempt } from "@/lib/data/speaking-submission";
import { attachRecordingToAttempt } from "@/lib/data/uploads";
import { getStorageService } from "@/lib/services/storage";

/**
 * GET    /api/speaking/attempts/:id  — one attempt (owner, or a reviewer)
 * DELETE /api/speaking/attempts/:id  — discard an unsubmitted attempt and its
 *                                      recording object
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const attempt = await db.query.speakingAttempts.findFirst({
    where: eq(speakingAttempts.id, id),
  });
  if (!attempt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const isReviewer = isStaff(user.role);
  if (!isReviewer && attempt.userId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, attempt: isReviewer ? attempt : learnerSpeakingAttempt(attempt) });
}

/**
 * DELETE only works while the attempt is still `recording`. Once submitted it
 * is part of the student's history and removing it would silently rewrite
 * their progress.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await discardSpeakingAttempt(db, user.id, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const key = result.objectKey;
  if (key) {
    const storage = getStorageService();
    await storage.delete(key).catch((err) => console.warn(`Failed to delete recording ${key}:`, err));
  }

  return NextResponse.json({ ok: true });
}

/** PATCH attaches a finalized recording upload to this attempt. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const uploadId = body?.uploadId;
  const durationMs = body?.durationMs;
  if (typeof uploadId !== "string") {
    return NextResponse.json({ error: "invalid_upload_id" }, { status: 400 });
  }

  const result = await attachRecordingToAttempt({
    userId: user.id,
    attemptId: id,
    uploadId,
    durationMs: typeof durationMs === "number" ? durationMs : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, objectKey: result.objectKey });
}
