import { NextResponse, type NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { canManageWriting } from "@/lib/auth/writing-admin";
import { isUuid } from "@/lib/validation/ids";
import { saveWritingContent } from "@/lib/services/writing/admin";
import { isWritingAdminKind } from "@/lib/writing/admin-schemas";

export const dynamic = "force-dynamic";

/** PUT /api/admin/writing/:kind/:id — edit an existing Writing content item. ADMIN/OWNER only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated" } }, { status: 401 });
  if (!canManageWriting(user.role)) return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  if (!isWritingAdminKind(kind) || !isUuid(id)) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const r = await saveWritingContent(kind, id, await req.json().catch(() => null), user.id);
  if (!r.ok) return NextResponse.json({ error: { code: "invalid", issues: r.issues } }, { status: r.issues.includes("not_found") ? 404 : r.issues.includes("write_failed") ? 500 : 400 });
  return NextResponse.json({ ok: true, id: r.id });
}
