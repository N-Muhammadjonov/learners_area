import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClasses } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { updateLiveClassSchema } from "@/lib/validation/live-classes";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!isStaff(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

  const body = await req.json().catch(() => null);
  const parsed = updateLiveClassSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (parsed.data.status) update.status = parsed.data.status;
  if (parsed.data.recordingUrl) update.recordingUrl = parsed.data.recordingUrl;
  if (parsed.data.meetingUrl) update.meetingUrl = parsed.data.meetingUrl;

  await db.update(liveClasses).set(update).where(eq(liveClasses.id, id));
  return NextResponse.json({ ok: true });
}
