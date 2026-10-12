import { NextRequest, NextResponse } from "next/server";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { listContentItems } from "@/lib/content/authoring";

/**
 * GET /api/admin/content/items?module=&contentType=
 *
 * One row per content item (its newest revision), which is what the authoring
 * workspace lists. Staff-only; learners read the published content through the
 * ordinary module routes, never through here.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const moduleFilter = req.nextUrl.searchParams.get("module") ?? undefined;
  const contentType = req.nextUrl.searchParams.get("contentType") ?? undefined;
  const items = await listContentItems({ module: moduleFilter, contentType });
  return NextResponse.json({ items });
}
