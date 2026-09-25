import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningQuestions, listeningMcqSessions } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getOwnedMcqSession } from "@/lib/data/listening";
import { advance, type McqStage } from "@/lib/services/listening/mcq-mastery";
import { buildMcqPayload } from "@/lib/services/listening/mcq-payload";

const schema = z.object({
  step: z.string().min(1).max(20),
  text: z.string().max(2000).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const session = await getOwnedMcqSession(user.id, params.id);
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const question = await db.query.listeningQuestions.findFirst({
    where: eq(listeningQuestions.id, session.questionId),
  });
  if (!question) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(buildMcqPayload(session, question));
}

/** One legal step of the drill. Skipping ahead is refused with 409. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const session = await getOwnedMcqSession(user.id, params.id);
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const question = await db.query.listeningQuestions.findFirst({
    where: eq(listeningQuestions.id, session.questionId),
  });
  if (!question) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = advance(session.stage as McqStage, {
    step: parsed.data.step,
    text: parsed.data.text,
    options: question.options ?? [],
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
    .where(eq(listeningMcqSessions.id, session.id))
    .returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(buildMcqPayload(updated, question));
}
