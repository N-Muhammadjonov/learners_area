import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { mayAuthorContent } from "@/lib/content/authoring-access";
import { loadLessonEditModel } from "@/lib/content/lesson-edit";
import { isUuid } from "@/lib/validation/ids";

/**
 * GET /api/admin/content/lessons/:id/edit
 *
 * The EDITABLE lesson, for the staff authoring desk.
 *
 * A list row is not an editor: this is the bounded projection that carries every field
 * an author may change — identity, learning area, description, teacher notes, estimated
 * time and the typed blocks WITH their media metadata — plus the revision state
 * (published / editable draft / scheduled) so the desk can show what a save would
 * actually change.
 *
 * It is staff-only and bounded by the same capability as authoring a lesson, so a
 * teacher can load exactly the content they may write. Quiz answers ARE returned, which
 * is the point of an authoring surface — and is why this route is never reachable from
 * a learner read path.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!mayAuthorContent(user.role, "lesson", "lesson")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const model = await loadLessonEditModel(id);
  if (!model) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ lesson: model });
}
