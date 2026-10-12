import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { requireActiveUser } from "@/lib/auth/current-user";
import { answerLessonQuiz } from "@/lib/content/lessons";

const answerSchema = z.object({ answer: z.string().min(1).max(500) });

/**
 * POST /api/lessons/blocks/:blockId/answer
 *
 * Grade one lesson quiz answer through the canonical question-type registry. The
 * verdict is the server's; the browser is told whether it was right, and gets the
 * key only when it was.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ blockId: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = answerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { blockId } = await context.params;
  const result = await db.transaction((tx) => answerLessonQuiz(tx, { userId: user.id, blockId, answer: parsed.data.answer }));
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.reason === "block_not_found" ? 404 : 409 });
  return NextResponse.json({ ok: true, correct: result.correct, correctAnswer: result.correctAnswer });
}
