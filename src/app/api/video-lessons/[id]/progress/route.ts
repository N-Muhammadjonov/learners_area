import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isLive } from "@/lib/services/cms/publication";
import { getVideoLessonForLesson, recordWatched } from "@/lib/data/video-lessons";
import { db } from "@/db/client";
import { videoLessons } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/video-lessons/:id/progress
 *
 * Records how far the player has got. The client sends a number; the server
 * clamps it to the authored duration and keeps it monotonic, so refreshing the
 * page or seeking backwards cannot lower it, and a scripted call cannot claim
 * the student watched more than the video holds. Opening the page alone is not
 * progress.
 */
const schema = z.object({ watchedSeconds: z.number().finite().min(0).max(60 * 60 * 12) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const videoLesson = await db.query.videoLessons.findFirst({ where: eq(videoLessons.id, id) });
  // A lesson that is not live cannot be marked as watched: nothing may count
  // progress on content the centre withdrew or has not opened yet.
  if (!videoLesson || !isLive(videoLesson)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const progress = await recordWatched(videoLesson.id, user.id, parsed.data.watchedSeconds);
  if (!progress) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    state: progress.state,
    watchedSeconds: progress.watchedSeconds,
    completedAt: progress.completedAt,
  });
}

/** GET returns the stored state for this student, without changing anything. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const videoLesson = await db.query.videoLessons.findFirst({ where: eq(videoLessons.id, id) });
  if (!videoLesson || !isLive(videoLesson)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const data = await getVideoLessonForLesson(videoLesson.lessonId, user.id);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    state: data.progress?.state ?? "not_started",
    watchedSeconds: data.progress?.watchedSeconds ?? 0,
    answers: data.progress?.answers ?? {},
  });
}
