import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { videoLessons } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { submitAnswers } from "@/lib/data/video-lessons";
import { isLive } from "@/lib/services/cms/publication";
import { RULES, clientKey, enforce } from "@/lib/http/rate-limit";

/**
 * POST /api/video-lessons/:id/answers
 *
 * The student sends what they typed; the server grades it against the centre's
 * authored answer set and decides whether the lesson is complete. A verdict
 * never arrives from the client.
 */
const schema = z.object({ answers: z.record(z.string().uuid(), z.string().max(500)) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const limited = enforce(RULES.evaluation, clientKey(req));
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const videoLesson = await db.query.videoLessons.findFirst({ where: eq(videoLessons.id, id) });
  // A lesson that was withdrawn or is not published yet cannot be answered —
  // and it looks exactly like a lesson that does not exist.
  if (!videoLesson || !isLive(videoLesson)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await submitAnswers(videoLesson.id, user.id, parsed.data.answers);
  if (!result) return NextResponse.json({ error: "no_questions" }, { status: 409 });

  // The correct answers are NOT returned — only whether each answer was right —
  // so the exercise keeps working as an exercise after a refresh.
  return NextResponse.json({
    graded: result.graded,
    state: result.state,
    completedAt: result.completedAt,
  });
}
