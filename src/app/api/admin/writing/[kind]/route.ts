import { NextResponse, type NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { canManageWriting } from "@/lib/auth/writing-admin";
import { saveWritingContent } from "@/lib/services/writing/admin";
import { isWritingAdminKind } from "@/lib/writing/admin-schemas";

export const dynamic = "force-dynamic";

/** POST /api/admin/writing/:kind — create a Writing content item (always a draft). ADMIN/OWNER only. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated" } }, { status: 401 });
  if (!canManageWriting(user.role)) return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  if (!isWritingAdminKind(kind)) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const r = await saveWritingContent(kind, null, await req.json().catch(() => null), user.id);
  if (!r.ok) return NextResponse.json({ error: { code: "invalid", issues: r.issues } }, { status: r.issues.includes("write_failed") ? 500 : 400 });
  return NextResponse.json({ ok: true, id: r.id });
}
