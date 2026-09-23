import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningQuestions } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { createListeningQuestionSchema } from "@/lib/validation/admin";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || (session.role !== "teacher" && session.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createListeningQuestionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  const existing = await db.query.listeningQuestions.findMany({ where: eq(listeningQuestions.testId, params.id) });

  const [created] = await db
    .insert(listeningQuestions)
    .values({
      testId: params.id,
      order: existing.length + 1,
      type: parsed.data.type,
      questionText: parsed.data.questionText,
      options: parsed.data.options && parsed.data.options.length > 0 ? parsed.data.options : undefined,
      correctAnswer: parsed.data.correctAnswer,
      explanation: parsed.data.explanation,
    })
    .returning();

  return NextResponse.json({ ok: true, id: created!.id });
}
