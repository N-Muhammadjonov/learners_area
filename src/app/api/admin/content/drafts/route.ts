import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { mayPublishImportedContent } from "@/lib/import/core/permissions";
import { saveContentDraft } from "@/lib/content/authoring";
import { saveDraftRequestSchema } from "@/lib/validation/content-authoring";

/**
 * POST /api/admin/content/drafts
 *
 * Create or revise an authored draft. Thin on purpose: parse, one service call,
 * one status code. Whether the payload is valid is decided by the content type's
 * own author, not by this route.
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = saveDraftRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  const result = await db.transaction((tx) =>
    saveContentDraft(tx, {
      actor: { id: user.id, role: user.role, mayPublish: mayPublishImportedContent(user.role) },
      module: parsed.data.module,
      contentType: parsed.data.contentType,
      sourceRef: parsed.data.sourceRef,
      title: parsed.data.title,
      track: parsed.data.track,
      payload: parsed.data.payload,
      note: parsed.data.note ?? null,
      versionId: parsed.data.versionId ?? null,
    }),
  );

  if (!result.ok) return NextResponse.json({ ok: false, issues: result.issues }, { status: 422 });
  return NextResponse.json(
    { ok: true, versionId: result.version.id, versionNo: result.version.versionNo, created: result.created },
    { status: result.created ? 201 : 200 },
  );
}
