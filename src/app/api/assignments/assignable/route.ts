import { NextResponse } from "next/server";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { listAssignableContent } from "@/lib/content/assignments";

/**
 * GET /api/assignments/assignable — what staff may set as work.
 *
 * One entry per canonical content item with a revision a learner could actually
 * open: published, not archived, not merely scheduled. This is the picker's data
 * source, so the list a teacher chooses from and the revision `createAssignment`
 * pins are produced by the same rule (§24/§41).
 *
 * Staff only: a learner has no use for the catalogue of assignable work.
 */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const items = await listAssignableContent();
  return NextResponse.json(
    { ok: true, items },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
