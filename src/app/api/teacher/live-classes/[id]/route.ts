import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClasses } from "@/db/schema";
import { isAdministrator, isStaff, requireActiveUser } from "@/lib/auth/current-user";
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
  // Every field in the schema is optional, so a body of `{}` validates and leaves nothing to set.
  // Passing that to `.set({})` throws inside drizzle and surfaces as a 500; it is a bad request.
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  /*
   * Ownership is part of the WHERE clause, not a pre-read. The create route stamps
   * `teacher_user_id` with the acting teacher, so a class has an owner; this update used to match on
   * the id alone, which let any teacher cancel another teacher's class and overwrite its
   * `meeting_url` — the link learners are handed to join. Scoping in the same statement also closes
   * the window a read-then-write would leave open.
   *
   * `roles.ts`: `isStaff` may author and review centre content, `isAdministrator` "may run
   * centre-wide administration". Reaching another teacher's class is centre-wide, so it stays an
   * administrator and owner capability.
   */
  const scope = isAdministrator(user.role)
    ? eq(liveClasses.id, id)
    : and(eq(liveClasses.id, id), eq(liveClasses.teacherUserId, user.id));
  const [updated] = await db
    .update(liveClasses)
    .set(update)
    .where(scope)
    .returning({ id: liveClasses.id });
  // 404 rather than 403: a class this teacher does not own is not distinguishable from one that
  // does not exist, and 403 would confirm that another teacher's class exists at that id.
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
