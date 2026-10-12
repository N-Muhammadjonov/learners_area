import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { canManageWriting } from "@/lib/auth/writing-admin";
import { saveWritingContent } from "@/lib/services/writing/admin";

/**
 * Legacy create endpoint (kept for old forms/bookmarks). It is a thin alias of
 * POST /api/admin/writing/prompt — same validation, same service, same audit.
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!canManageWriting(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const r = await saveWritingContent("prompt", null, await req.json().catch(() => null), user.id);
  if (!r.ok) return NextResponse.json({ error: "invalid_input", issues: r.issues }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id });
}
