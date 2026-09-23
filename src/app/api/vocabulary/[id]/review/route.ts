import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { userVocabulary, activityEvents } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scheduleReview, isActivated, type ReviewGrade } from "@/lib/services/spaced-repetition";

const gradeSchema = z.object({ grade: z.enum(["again", "hard", "good", "easy"]) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = gradeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const entry = await db.query.userVocabulary.findFirst({
    where: and(eq(userVocabulary.id, params.id), eq(userVocabulary.userId, session.sub)),
  });
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = scheduleReview({
    grade: parsed.data.grade as ReviewGrade,
    intervalDays: entry.intervalDays,
    correctCount: entry.correctCount,
    incorrectCount: entry.incorrectCount,
  });

  const nextActiveUseCount =
    parsed.data.grade === "easy" ? entry.activeUseCount + 1 : entry.activeUseCount;

  await db
    .update(userVocabulary)
    .set({
      intervalDays: result.intervalDays,
      correctCount: result.correctCount,
      incorrectCount: result.incorrectCount,
      state: isActivated(nextActiveUseCount) ? "activated" : result.state,
      activeUseCount: nextActiveUseCount,
      nextReviewAt: result.nextReviewAt,
      lastReviewedAt: new Date(),
    })
    .where(eq(userVocabulary.id, entry.id));

  await db.insert(activityEvents).values({ userId: session.sub, type: "VOCAB_REVIEWED", payload: { id: entry.id } });

  return NextResponse.json({ ok: true, nextReviewAt: result.nextReviewAt });
}
