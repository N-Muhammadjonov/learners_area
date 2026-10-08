import { mcqAccess } from "@/lib/services/listening/mcq-access";
import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningQuestions, listeningMcqSessions } from "@/db/schema";
import { listeningQuestionIsLive } from "@/lib/listening/question-set";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getOwnedMcqSession } from "@/lib/data/listening";
import { advance, type McqStage } from "@/lib/services/listening/mcq-mastery";
import { buildMcqPayload } from "@/lib/services/listening/mcq-payload";

const schema = z.object({
  step: z.string().min(1).max(20),
  text: z.string().max(2000).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const session = await getOwnedMcqSession(user.id, id);
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const question = await db.query.listeningQuestions.findFirst({
    where: eq(listeningQuestions.id, session.questionId),
  });
  if (!question) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const access = await mcqAccess(user, question.testId);
  if (access !== "ok") return NextResponse.json({ error: access }, { status: access === "not_found" ? 404 : 409 });
  // A session on a question that has since been replaced stops here rather than advancing the
  // drill against rows no learner can be given any more.
  if (!(await listeningQuestionIsLive(question.id, question.testId)))
    return NextResponse.json({ error: "not_found" }, { status: 404 });


  return NextResponse.json(buildMcqPayload(session, question), { headers: { "Cache-Control": "private, no-store" } });
}

/** One legal step of the drill. Skipping ahead is refused with 409. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const session = await getOwnedMcqSession(user.id, id);
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const question = await db.query.listeningQuestions.findFirst({
    where: eq(listeningQuestions.id, session.questionId),
  });
  if (!question) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const access = await mcqAccess(user, question.testId);
  if (access !== "ok") return NextResponse.json({ error: access }, { status: access === "not_found" ? 404 : 409 });
  // A session on a question that has since been replaced stops here rather than advancing the
  // drill against rows no learner can be given any more.
  if (!(await listeningQuestionIsLive(question.id, question.testId)))
    return NextResponse.json({ error: "not_found" }, { status: 404 });


  const result = advance(session.stage as McqStage, {
    step: parsed.data.step,
    text: parsed.data.text,
    options: question.options ?? [],
    multi: question.typeCode === "mcq_multi",
  });
  if (!result.ok) {
    const status = result.error === "not_in_options" ? 400 : 409;
    return NextResponse.json({ error: result.error, stage: session.stage }, { status });
  }

  const text = (parsed.data.text ?? "").trim();
  const patch: Partial<typeof listeningMcqSessions.$inferInsert> = {
    stage: result.stage,
    updatedAt: new Date(),
  };
  if (result.stage === "notes") patch.notes = text;
  if (result.stage === "committed") patch.ownAnswer = text;
  if (result.stage === "chosen") patch.chosenAnswer = text;
  if (result.stage === "reasoned") patch.reasoning = text;

  const [updated] = await db
    .update(listeningMcqSessions)
    .set(patch)
    .where(and(eq(listeningMcqSessions.id, session.id), eq(listeningMcqSessions.stage, session.stage)))
    .returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(buildMcqPayload(updated, question), { headers: { "Cache-Control": "private, no-store" } });
}
