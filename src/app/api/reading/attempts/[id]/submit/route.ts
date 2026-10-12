import { isUuid } from "@/lib/validation/ids";
import { touchMeaningfulActivity } from "@/lib/services/activity";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { submitReadingAttempt } from "@/lib/services/reading/submit";

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

  const result = await submitReadingAttempt(id,user.id,parsed.data.answers);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  // Grading has committed. A secondary activity refresh must not report it as failed.
  await touchMeaningfulActivity(user.id).catch(() => console.error("[reading] activity refresh unavailable after submit"));
  return NextResponse.json({ ok: true, score: result.score, totalQuestions: result.totalQuestions });
}
