import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarExercises, grammarAttempts, activityEvents } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";

const schema = z.object({
  answers: z.array(z.object({ exerciseId: z.string().uuid(), selectedOption: z.string().min(1) })),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const exercises = await db.query.grammarExercises.findMany({ where: eq(grammarExercises.topicId, params.id) });
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  const results: { exerciseId: string; isCorrect: boolean; correctOption: string; explanation: string }[] = [];
  const rows = [];

  for (const a of parsed.data.answers) {
    const ex = exerciseById.get(a.exerciseId);
    if (!ex) continue;
    const isCorrect = a.selectedOption === ex.correctOption;
    results.push({ exerciseId: ex.id, isCorrect, correctOption: ex.correctOption, explanation: ex.explanation });
    rows.push({
      userId: user.id,
      exerciseId: ex.id,
      selectedOption: a.selectedOption,
      isCorrect,
    });
  }

  if (rows.length > 0) {
    await db.insert(grammarAttempts).values(rows);
    await db.insert(activityEvents).values({
      userId: user.id,
      type: "GRAMMAR_TOPIC_ATTEMPTED",
      payload: { topicId: params.id, correct: results.filter((r) => r.isCorrect).length, total: results.length },
    });
  }

  return NextResponse.json({ ok: true, results });
}
