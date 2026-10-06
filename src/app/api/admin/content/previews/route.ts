import { NextResponse } from "next/server";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { previewInventory } from "@/lib/content/preview";

/**
 * GET /api/admin/content/previews — which authorable types have a native preview.
 *
 * The §Z inventory, computed from the author registry rather than written by hand, so
 * the answer cannot drift from the code: a type appears as PREVIEW_READY only when a
 * projection exists for it.
 */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const items = previewInventory();
  return NextResponse.json(
    { ok: true, items, missing: items.filter((item) => item.status === "MISSING").map((item) => `${item.module}:${item.contentType}`) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
