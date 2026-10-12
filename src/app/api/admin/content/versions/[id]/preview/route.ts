import { NextRequest, NextResponse } from "next/server";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { previewContentVersion } from "@/lib/content/preview";

/**
 * GET /api/admin/content/versions/:id/preview
 *
 * The native preview of ONE revision, staff-only.
 *
 * It is deliberately NOT gated on publication: previewing a draft before publishing it
 * is the whole point. What protects learners is that this route refuses anyone who is
 * not staff, and that nothing here is used by a learner read path — the learner reads
 * keep their own publication gates.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { id } = await context.params;
  const preview = await previewContentVersion(id);
  if (!preview) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(
    { ok: true, preview },
    { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
