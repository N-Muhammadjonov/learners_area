import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { writingFeedback, writingSubmissions, activityEvents } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { mayAssignTo } from "@/lib/content/assignments";

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

  /*
   * AUTHORITY, NOT JUST ROLE.
   *
   * `isStaff` is three roles wide — teacher, admin, owner — and on its own it let ANY teacher grade
   * ANY learner's writing. The route took a submission id, looked the row up, and wrote feedback
   * attributed to whoever asked, without ever establishing that this teacher was entitled to assess
   * this learner. Measured before this change (scripts/verify-teacher-feedback-authority.mjs): an
   * unrelated teacher with no roster link received HTTP 200 and created BOTH a writing_feedback row
   * and a TEACHER_FEEDBACK_RECEIVED notification to the learner, and under three concurrent requests
   * both unauthorized ones landed. Because a real submission answered 200 while a nonexistent one
   * answered 404, the endpoint also worked as an oracle for enumerating which submission ids exist.
   *
   * The rule is not invented here. mayAssignTo() in src/lib/content/assignments.ts is where this
   * product already states it — "a TEACHER may only set work for a student on their own roster
   * (`teacher_student_links` — the same explicit roster the Reporter uses, so nothing is inferred);
   * an administrator may set work for any student" — and its own comment says the rule lives in one
   * place. Grading a learner's work is the same authority relationship as setting it, so this route
   * is held to the rule the rest of the product already enforces, and the legitimate centre-wide
   * authority of admin and owner is preserved rather than narrowed.
   *
   * The decision is made INSIDE the transaction that writes, so a roster change cannot slip between
   * the check and the commit, and a denial writes nothing at all — no feedback row, no activity
   * event, no learner notification.
   *
   * A denial answers 404 with exactly the body a missing submission gets, following the convention
   * the Reporter documents: a subject that is not visible to the actor yields the same 404 as one
   * that does not exist, so this endpoint cannot be used to probe which submissions are real.
   */
  const result = await db.transaction(async (tx) => {
    const authority = await mayAssignTo({ id: user.id, role: user.role }, submission.userId, tx as never);
    if (!authority.allowed) return { allowed: false as const };

    // One transaction (B3, same defect class as POST /api/assignments): the feedback row
    // and the learner's notification used to be two independent writes. A failing event
    // left committed feedback behind a 500, and the teacher's retry added a SECOND band
    // and comment to the same submission — the learner then saw two conflicting verdicts
    // for one piece of work.
    await tx.insert(writingFeedback).values({
      submissionId: submission.id,
      source: "teacher",
      overallBand: parsed.data.overallBand,
      comment: parsed.data.comment,
      teacherId: user.id,
    });

    await tx.insert(activityEvents).values({
      userId: submission.userId,
      type: "TEACHER_FEEDBACK_RECEIVED",
      payload: { submissionId: submission.id, teacherId: user.id },
    });

    return { allowed: true as const };
  });

  if (!result.allowed) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
