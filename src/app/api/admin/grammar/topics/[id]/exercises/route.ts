import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarExercises, grammarTopics, writingSubmissions } from "@/db/schema";
import { isAdministrator, requireActiveUser } from "@/lib/auth/current-user";
import { createGrammarExerciseSchema } from "@/lib/validation/admin";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isAdministrator(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createGrammarExerciseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  if (!parsed.data.options.includes(parsed.data.correctOption)) {
    return NextResponse.json({ error: "correct_option_must_be_one_of_options" }, { status: 400 });
  }

  if (!await db.query.grammarTopics.findFirst({ where: eq(grammarTopics.id, id), columns: { id: true } })) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (parsed.data.sourceSubmissionId && !await db.query.writingSubmissions.findFirst({
    where: eq(writingSubmissions.id, parsed.data.sourceSubmissionId), columns: { id: true },
  })) {
    return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  }

  const existing = await db.query.grammarExercises.findMany({ where: eq(grammarExercises.topicId, id) });

  const [created] = await db
    .insert(grammarExercises)
    .values({
      topicId: id,
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
