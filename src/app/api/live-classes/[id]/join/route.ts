import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClassAttendance, activityEvents } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const existing = await db.query.liveClassAttendance.findFirst({
    where: and(eq(liveClassAttendance.liveClassId, params.id), eq(liveClassAttendance.userId, user.id)),
  });
  if (!existing) {
    await db.insert(liveClassAttendance).values({ liveClassId: params.id, userId: user.id });
    await db.insert(activityEvents).values({
      userId: user.id,
      type: "LIVE_CLASS_ATTENDED",
      payload: { liveClassId: params.id },
    });
  }

  return NextResponse.json({ ok: true });
}
