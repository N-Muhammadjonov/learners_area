import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { mayPublishImportedContent } from "@/lib/import/core/permissions";
import { publishContentVersion } from "@/lib/content/authoring";
import { publicationRequestSchema } from "@/lib/validation/content-authoring";

/**
 * POST /api/admin/content/versions/:id/publication
 *
 * The one door between authored content and students. A teacher may move a draft
 * through the workflow, but only an administrator or owner may publish or
 * schedule it — the role check is the service's, so any other caller gets the
 * same answer.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = publicationRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  const { id } = await context.params;
  const result = await db.transaction((tx) =>
    publishContentVersion(tx, {
      actor: { id: user.id, role: user.role, mayPublish: mayPublishImportedContent(user.role) },
      versionId: id,
      to: parsed.data.to,
      publishAt: parsed.data.publishAt ? new Date(parsed.data.publishAt) : null,
    }),
  );

  if (!result.ok) {
    const forbidden = result.issues.some((issue) => issue.code === "publish_forbidden");
    return NextResponse.json({ ok: false, issues: result.issues }, { status: forbidden ? 403 : 422 });
  }
  return NextResponse.json({ ok: true, versionId: result.version.id, publicationState: result.state });
}
