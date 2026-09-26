import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, lexemes, userVocabulary } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { evaluateVocabularyUsage } from "@/lib/services/coach";
import { confirmSentenceUse, recordSentenceUse } from "@/lib/services/vocabulary/engine";

/**
 * POST /api/vocabulary/:id/use — use the word in a sentence.
 *
 * The sentence is stored first, truthfully labelled "manual", and only then sent
 * to the RIWI evaluator. That order matters: the student's work is never lost
 * because a provider was unavailable, and the bank never claims an evaluation
 * that did not happen.
 *
 * An accepted sentence is real evidence of active use, so it earns the largest
 * vocabulary award and moves mastery to ACTIVE (MASTERED at the last SRS stage).
 * This handler never touches the spaced-repetition ladder: recognition and
 * production are separate signals.
 */
const schema = z.object({ sentence: z.string().min(3).max(1000) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const entry = await db.query.userVocabulary.findFirst({
    where: and(eq(userVocabulary.id, id), eq(userVocabulary.userId, user.id)),
  });
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const lexeme = await db.query.lexemes.findFirst({ where: eq(lexemes.id, entry.lexemeId) });
  if (!lexeme) return NextResponse.json({ error: "lexeme_missing" }, { status: 500 });

  const stored = await recordSentenceUse({
    userId: user.id,
    entryId: entry.id,
    sentence: parsed.data.sentence,
    origin: "manual",
    accepted: false,
  });
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: 404 });

  const outcome = await evaluateVocabularyUsage({
    userId: user.id,
    usageId: stored.usageId,
    targetWord: lexeme.term,
    definition: lexeme.definitionEn,
    studentSentence: parsed.data.sentence,
    language: await getLocale(),
  });

  if (!outcome.ok) {
    // The sentence stays in the bank, labelled as not evaluated, worth nothing.
    return NextResponse.json(
      { error: outcome.error, usageId: stored.usageId, origin: "manual", accepted: false, points: 0 },
      { status: 502 }
    );
  }

  const accepted = outcome.evaluation.verdict === "correct";
  const confirmed = await confirmSentenceUse({
    userId: user.id,
    usageId: stored.usageId,
    accepted,
    evaluationId: outcome.evaluation.id,
  });

  await db.insert(activityEvents).values({
    userId: user.id,
    type: "VOCABULARY_USED",
    payload: { lexemeId: lexeme.id, verdict: outcome.evaluation.verdict, accepted },
  });

  return NextResponse.json({
    ok: true,
    usageId: stored.usageId,
    verdict: outcome.evaluation.verdict,
    accepted,
    checkedBy: outcome.evaluation.checkedBy.displayName,
    mastery: confirmed.ok ? confirmed.mastery : null,
    points: confirmed.ok ? confirmed.points : 0,
  });
}
