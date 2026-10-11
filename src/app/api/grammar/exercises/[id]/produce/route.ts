import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { getLocale } from "@/lib/i18n";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { submitGrammarProduction } from "@/lib/data/grammar-production-write";
import { z } from "zod";

const schema = z.object({ answer: z.string().trim().min(1).max(2000) }).strict();

/** Written correction uses one canonical, atomically persisted Coach result.
 * Answer keys are released only after that source-bound commit succeeds. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const outcome = await submitGrammarProduction(user.id, id,
    { activity: "correct_it", answer: parsed.data.answer }, await getLocale());
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ ok: true, attemptId: outcome.attemptId,
    verdict: outcome.evaluation.verdict, checkedBy: PUBLIC_CHECKED_BY,
    sampleAnswer: outcome.sampleAnswer, explanation: outcome.explanation,
    issues: outcome.evaluation.issues.map(issue => issue.message) });
}
