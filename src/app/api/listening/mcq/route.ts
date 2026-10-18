import { mcqAccess } from "@/lib/services/listening/mcq-access";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningQuestions, listeningMcqSessions } from "@/db/schema";
import { listeningQuestionIsLive } from "@/lib/listening/question-set";
import { requireActiveUser } from "@/lib/auth/current-user";
import { buildMcqPayload } from "@/lib/services/listening/mcq-payload";

const schema = z.object({ questionId: z.string().uuid() });

/**
 * Open (or resume) an MCQ Mastery session for one multiple-choice question.
 *
 * Only questions of a test the student can actually see are allowed, and the
 * session belongs to the caller — a session id from somebody else's drill is
 * never reachable, because the id is only ever returned to its owner.
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const question = await db.query.listeningQuestions.findFirst({
    where: eq(listeningQuestions.id, parsed.data.questionId),
  });
  if (!question || question.type !== "multiple_choice") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const access = await mcqAccess(user, question.testId);
  if (access !== "ok") return NextResponse.json({ error: access }, { status: access === "not_found" ? 404 : access === "sequence_locked" ? 403 : 409 });
  // Drills always use the CURRENT set: a replaced revision's question is history, not practice.
  if (!(await listeningQuestionIsLive(question.id, question.testId)))
    return NextResponse.json({ error: "not_found" }, { status: 404 });


  const existing = await db.query.listeningMcqSessions.findFirst({
    where: and(
      eq(listeningMcqSessions.userId, user.id),
      eq(listeningMcqSessions.questionId, question.id)
    ),
  });

  const created = existing
    ? null
    : (
        await db
          .insert(listeningMcqSessions)
          .values({ userId: user.id, testId: question.testId, questionId: question.id })
          .returning()
      )[0];
  const session = existing ?? created;
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(buildMcqPayload(session, question), { headers: { "Cache-Control": "private, no-store" } });
}
