import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { readingQuestions } from "@/db/schema";
import { isAdministrator, requireActiveUser } from "@/lib/auth/current-user";
import { createReadingQuestionSchema } from "@/lib/validation/admin";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isAdministrator(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createReadingQuestionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  const existing = await db.query.readingQuestions.findMany({ where: eq(readingQuestions.passageId, params.id) });
  const nextOrder = existing.length + 1;

  const [created] = await db
    .insert(readingQuestions)
    .values({
      passageId: params.id,
      order: nextOrder,
      type: parsed.data.type,
      questionText: parsed.data.questionText,
      options: parsed.data.options && parsed.data.options.length > 0 ? parsed.data.options : undefined,
      correctAnswer: parsed.data.correctAnswer,
      evidenceQuote: parsed.data.evidenceQuote,
      explanation: parsed.data.explanation,
    })
    .returning();

  return NextResponse.json({ ok: true, id: created!.id });
}
