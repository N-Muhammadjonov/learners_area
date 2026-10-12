import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActiveUser } from "@/lib/auth/current-user";
import { mayPublishImportedContent } from "@/lib/import/core/permissions";
import { mayAuthorContent } from "@/lib/content/authoring-access";
import { startLessonRevision } from "@/lib/content/lesson-edit";
import { isUuid } from "@/lib/validation/ids";

/**
 * POST /api/admin/content/lessons/:id/revision
 *
 * START A REVISION of a lesson that students are reading.
 *
 * This is the explicit human action behind "Create revision": the published revision is
 * read, a COMPLETE COPY is written as a new editable draft, and the published revision
 * keeps serving learners untouched. Nothing about this request is destructive — the
 * previous revision is never rewritten, and the lesson keeps one stable identity
 * (`sourceRef`, lesson id) so Xulosangiz, history and references stay attached to it.
 *
 * Idempotent by design: if an editable draft already exists it is opened instead of
 * starting another one, so browsing the desk can never pile up revisions.
 */
export async function POST(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!mayAuthorContent(user.role, "lesson", "lesson")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await db.transaction((tx) =>
    startLessonRevision(tx, {
      lessonId: id,
      actor: { id: user.id, role: user.role, mayPublish: mayPublishImportedContent(user.role) },
    }),
  );

  if (!result.ok)
    return NextResponse.json(
      { ok: false, issues: result.issues },
      { status: result.issues.some((issue) => issue.code === "lesson_not_found") ? 404 : 422 },
    );

  return NextResponse.json(
    { ok: true, versionId: result.version.id, versionNo: result.version.versionNo, created: result.created, lesson: result.model },
    { status: result.created ? 201 : 200 },
  );
}
