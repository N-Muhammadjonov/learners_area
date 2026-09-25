import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { problemReports } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";

/** Only staff resolve a report, and only once — the first resolution stands. */
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [updated] = await db
    .update(problemReports)
    .set({ status: "resolved", resolvedByUserId: user.id, resolvedAt: new Date() })
    .where(and(eq(problemReports.id, params.id), isNull(problemReports.resolvedAt)))
    .returning();

  if (!updated) {
    const exists = await db.query.problemReports.findFirst({ where: eq(problemReports.id, params.id) });
    if (!exists) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ error: "already_resolved" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, status: updated.status });
}
