import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarExercises } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { createGrammarExerciseSchema } from "@/lib/validation/admin";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createGrammarExerciseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  if (!parsed.data.options.includes(parsed.data.correctOption)) {
    return NextResponse.json({ error: "correct_option_must_be_one_of_options" }, { status: 400 });
  }

  const existing = await db.query.grammarExercises.findMany({ where: eq(grammarExercises.topicId, params.id) });

  const [created] = await db
    .insert(grammarExercises)
    .values({
      topicId: params.id,
      order: existing.length + 1,
      promptText: parsed.data.promptText,
      options: parsed.data.options,
      correctOption: parsed.data.correctOption,
      explanation: parsed.data.explanation,
      sourceSubmissionId: parsed.data.sourceSubmissionId,
    })
    .returning();

  return NextResponse.json({ ok: true, id: created!.id });
}
