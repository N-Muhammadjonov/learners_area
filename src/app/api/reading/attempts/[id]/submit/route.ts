import { submitReadingAttempt } from "@/lib/data/reading-attempt-write";
import { isUuid } from "@/lib/validation/ids";
import { touchMeaningfulActivity } from "@/lib/services/activity";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";

const schema = z.object({
  answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.string().max(500) })),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // Autosave and submission serialize on the attempt row. A concurrent late
  // autosave must not overwrite a score after a submit has committed, and two
  // submit clicks cannot both grade the same in-progress attempt.
  const result = await submitReadingAttempt(user.id, id, parsed.data.answers);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await touchMeaningfulActivity(user.id);
  return NextResponse.json({ ok: true, score: result.score, totalQuestions: result.totalQuestions });
}
