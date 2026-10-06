import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { loadLessonForLearner } from "@/lib/content/lessons";

/**
 * GET /api/lessons/:lessonId
 *
 * A learner reading a lesson: typed blocks, canonical content resolved behind the
 * references, their own quiz responses — and never an answer key they have not
 * earned by answering.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ lessonId: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { lessonId } = await context.params;
  const lesson = await loadLessonForLearner(lessonId, user.id);
  if (!lesson) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    lesson: {
      id: lesson.lesson.id,
      title: lesson.lesson.title,
      summary: lesson.lesson.summary,
      estimatedMinutes: lesson.lesson.estimatedMinutes,
    },
    blocks: lesson.blocks,
    progress: lesson.progress,
  });
}
