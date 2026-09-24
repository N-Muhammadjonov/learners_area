import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { liveClasses, courses } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { createLiveClassSchema } from "@/lib/validation/live-classes";

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!isStaff(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

  const body = await req.json().catch(() => null);
  const parsed = createLiveClassSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  const ielts = await db.query.courses.findFirst({ where: eq(courses.slug, "ielts") });
  if (!ielts) return NextResponse.json({ error: "no_course" }, { status: 500 });

  const [created] = await db
    .insert(liveClasses)
    .values({
      courseId: ielts.id,
      teacherUserId: user.id,
      title: parsed.data.title,
      topic: parsed.data.topic,
      scheduledAt: new Date(parsed.data.scheduledAt),
      durationMinutes: parsed.data.durationMinutes,
      meetingUrl: parsed.data.meetingUrl || undefined,
    })
    .returning();

  return NextResponse.json({ ok: true, id: created!.id });
}
