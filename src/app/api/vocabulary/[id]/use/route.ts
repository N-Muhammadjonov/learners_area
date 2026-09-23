import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, lexemes, userVocabulary } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { createVocabularyUsage } from "@/lib/data/coach-artifacts";
import { evaluateVocabularyUsage } from "@/lib/services/coach";

/**
 * POST /api/vocabulary/:id/use — evaluate active use of a word.
 *
 * Recognition (the review queue) and production (this) stay separate signals,
 * and this handler deliberately does not touch the spaced-repetition counters:
 * one automated verdict on one sentence is not evidence that a word is
 * mastered, and overwriting the schedule with it would corrupt the queue.
 */
const schema = z.object({ sentence: z.string().min(3).max(1000) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const entry = await db.query.userVocabulary.findFirst({
    where: and(eq(userVocabulary.id, params.id), eq(userVocabulary.userId, session.sub)),
  });
  if (!entry) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const lexeme = await db.query.lexemes.findFirst({ where: eq(lexemes.id, entry.lexemeId) });
  if (!lexeme) return NextResponse.json({ error: "lexeme_missing" }, { status: 500 });

  const usage = await createVocabularyUsage({
    userId: session.sub,
    userVocabularyId: entry.id,
    sentence: parsed.data.sentence,
  });

  const outcome = await evaluateVocabularyUsage({
    userId: session.sub,
    usageId: usage.id,
    targetWord: lexeme.term,
    definition: lexeme.definitionEn,
    studentSentence: parsed.data.sentence,
    language: getLocale(),
  });

  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 502 });

  await db.insert(activityEvents).values({
    userId: session.sub,
    type: "VOCABULARY_USED",
    payload: { lexemeId: lexeme.id, verdict: outcome.evaluation.verdict },
  });

  return NextResponse.json({
    ok: true,
    usageId: usage.id,
    verdict: outcome.evaluation.verdict,
    checkedBy: outcome.evaluation.checkedBy.displayName,
  });
}
