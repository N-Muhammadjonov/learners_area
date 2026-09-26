import { isUuid } from "@/lib/validation/ids";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClasses, liveClassAttendance, activityEvents } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { joinState, opensAt } from "@/lib/services/live-classes/window";

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

  const existing = await db.query.liveClassAttendance.findFirst({
    where: and(eq(liveClassAttendance.liveClassId, id), eq(liveClassAttendance.userId, user.id)),
  });
  if (!existing) {
    await db.insert(liveClassAttendance).values({ liveClassId: id, userId: user.id });
    await db.insert(activityEvents).values({
      userId: user.id,
      type: "LIVE_CLASS_ATTENDED",
      payload: { liveClassId: id },
    });
  }

  return NextResponse.json({ ok: true, joined: true, joinedAt: (existing?.joinedAt ?? new Date()).toISOString() });
}
