import { NextRequest, NextResponse } from "next/server";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { versionsOf } from "@/lib/content/authoring";
import { versionContent } from "@/lib/content/versions";

/**
 * GET /api/admin/content/items/:module/:contentType/:sourceRef
 *
 * Every revision of one content item, newest first, with the publication state of
 * each. Staff-only: this is the revision history a learner never sees.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ module: string; contentType: string; sourceRef: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { module, contentType, sourceRef } = await context.params;
  const versions = await versionsOf(module, contentType, sourceRef);
  if (versions.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    module,
    contentType,
    sourceRef,
    versions: versions.map((version) => ({
      id: version.id,
      versionNo: version.versionNo,
      status: version.status,
      publicationState: version.publicationState,
      title: version.title,
      track: version.track,
      answerKeyHash: version.answerKeyHash,
      targetType: version.targetType,
      targetId: version.targetId,
    })),
  });
}
