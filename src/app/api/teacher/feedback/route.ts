import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { writingFeedback, writingSubmissions, activityEvents } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";

const schema = z.object({
  submissionId: z.string().uuid(),
  comment: z.string().min(1).max(2000),
  overallBand: z.coerce.number().min(0).max(9).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!isStaff(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const submission = await db.query.writingSubmissions.findFirst({
    where: eq(writingSubmissions.id, parsed.data.submissionId),
  });
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db.insert(writingFeedback).values({
    submissionId: submission.id,
    source: "teacher",
    overallBand: parsed.data.overallBand,
    comment: parsed.data.comment,
    teacherId: user.id,
  });

  await db.insert(activityEvents).values({
    userId: submission.userId,
    type: "TEACHER_FEEDBACK_RECEIVED",
    payload: { submissionId: submission.id, teacherId: user.id },
  });

  return NextResponse.json({ ok: true });
}
