import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { writingLessonProgress } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { getWritingLesson } from "@/lib/data/writing-workspace";

/** POST /api/writing/lessons/:id — mark a published lesson complete (idempotent). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  if (!(await getWritingLesson(id, user.id))) return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  await db.insert(writingLessonProgress).values({ userId: user.id, lessonId: id }).onConflictDoNothing();
  return NextResponse.json({ ok: true });
}
