import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { typingRuns, activityEvents } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listTypingRuns, typingSummary } from "@/lib/data/writing";
import { computeTypingMetrics } from "@/lib/services/writing/typing";

const schema = z.object({
  targetText: z.string().min(1).max(4000),
  typedText: z.string().max(4000),
  durationMs: z.number().int().positive(),
});

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [summary, runs] = await Promise.all([typingSummary(user.id), listTypingRuns(user.id)]);
  return NextResponse.json({ summary, runs: runs.map((r) => ({ ...r, wpm: Number(r.wpm), accuracy: Number(r.accuracy) })) });
}

/**
 * Record a typing run.
 *
 * The client sends the two texts and the elapsed time; the server computes the
 * words per minute and the accuracy itself. A run outside the accepted duration
 * window is refused rather than recorded as a suspiciously fast personal best.
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  let metrics;
  try {
    metrics = computeTypingMetrics(parsed.data.targetText, parsed.data.typedText, parsed.data.durationMs);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid_input";
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  const [run] = await db
    .insert(typingRuns)
    .values({
      userId: user.id,
      targetChars: metrics.targetChars,
      typedChars: metrics.typedChars,
      durationMs: metrics.durationMs,
      wpm: metrics.wpm.toFixed(1),
      accuracy: metrics.accuracy.toFixed(1),
    })
    .returning();

  await db.insert(activityEvents).values({
    userId: user.id,
    type: "TYPING_RUN_COMPLETED",
    payload: { wpm: metrics.wpm, accuracy: metrics.accuracy, durationMs: metrics.durationMs },
  });

  const summary = await typingSummary(user.id);

  return NextResponse.json({
    run: { id: run!.id, ...metrics },
    summary,
  });
}
