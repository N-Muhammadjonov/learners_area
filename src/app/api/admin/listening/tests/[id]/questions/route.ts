import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningQuestions, listeningTests } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { createListeningQuestionSchema } from "@/lib/validation/admin";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (!isStaff(user.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

  const body = await req.json().catch(() => null);
  const parsed = createListeningQuestionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  /*
   * A LIVE item's question set may only change through a published revision.
   *
   * The old behaviour appended a legacy (revision-less) row straight into the canonical table.
   * On a published item that write is either invisible — learners read the published revision's
   * set, so the new question never appears — or, on an item that has no revision yet, a silent
   * content change to material learners are already being graded against. Neither is a real edit,
   * so it is refused and pointed at the desk that does it properly.
   */
  const [row] = await db
    .select({ publicationState: listeningTests.publicationState })
    .from(listeningTests)
    .where(eq(listeningTests.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.publicationState === "published" || row.publicationState === "scheduled") {
    return NextResponse.json({ error: "revision_managed" }, { status: 409 });
  }

  const existing = await db.query.listeningQuestions.findMany({ where: eq(listeningQuestions.testId, id) });

  const [created] = await db
    .insert(listeningQuestions)
    .values({
      testId: id,
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
