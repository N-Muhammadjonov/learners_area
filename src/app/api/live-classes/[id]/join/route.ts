import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClassAttendance, activityEvents } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const existing = await db.query.liveClassAttendance.findFirst({
    where: and(eq(liveClassAttendance.liveClassId, params.id), eq(liveClassAttendance.userId, session.sub)),
  });
  if (!existing) {
    await db.insert(liveClassAttendance).values({ liveClassId: params.id, userId: session.sub });
    await db.insert(activityEvents).values({
      userId: session.sub,
      type: "LIVE_CLASS_ATTENDED",
      payload: { liveClassId: params.id },
    });
  }

  return NextResponse.json({ ok: true });
}
