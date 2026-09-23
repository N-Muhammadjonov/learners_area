import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClasses } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { updateLiveClassSchema } from "@/lib/validation/live-classes";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "teacher" && session.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateLiveClassSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (parsed.data.status) update.status = parsed.data.status;
  if (parsed.data.recordingUrl) update.recordingUrl = parsed.data.recordingUrl;
  if (parsed.data.meetingUrl) update.meetingUrl = parsed.data.meetingUrl;

  await db.update(liveClasses).set(update).where(eq(liveClasses.id, params.id));
  return NextResponse.json({ ok: true });
}
