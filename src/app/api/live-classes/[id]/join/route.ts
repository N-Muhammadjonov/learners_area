import { isUuid } from "@/lib/validation/ids";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClasses } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { joinState, opensAt } from "@/lib/services/live-classes/window";
import { recordLiveClassAttendance } from "@/lib/services/live-classes/attendance";

/**
 * POST /api/live-classes/:id/join
 *
 * Records the student as having attended — which is why it is not a plain
 * "mark as read": the class has to exist, must not be cancelled, and has to be
 * inside its join window (or already live). Attendance is the centre's record of
 * who was in the room, so it is written while the room is actually open.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const liveClass = await db.query.liveClasses.findFirst({ where: eq(liveClasses.id, id) });
  if (!liveClass) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const state = joinState(liveClass, new Date());
  if (state !== "open") {
    return NextResponse.json(
      {
        error: state,
        opensAt: opensAt(liveClass).toISOString(),
        joined: false,
      },
      { status: 409 }
    );
  }

  /*
   * §04 — the write lives in a service so a concurrency test can exercise it directly. Behaviour is
   * unchanged by this extraction; the atomicity fix is a separate, evidenced step.
   */
  const attendance = await recordLiveClassAttendance(id, user.id);

  return NextResponse.json({ ok: true, joined: true, joinedAt: (attendance.joinedAt ?? new Date()).toISOString() });
}
