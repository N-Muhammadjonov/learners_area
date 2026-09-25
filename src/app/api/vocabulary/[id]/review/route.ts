import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { applyScheduledReview } from "@/lib/services/vocabulary/engine";

/**
 * POST /api/vocabulary/:id/review — one scheduled revision.
 *
 * This is the ONLY endpoint that moves the official ladder. The student reports
 * whether they recalled the word; the server applies the 1/3/7/16/35 schedule,
 * recomputes mastery, and writes one point to the ledger (idempotently, keyed by
 * the stage it moves to).
 */
const schema = z.object({ outcome: z.enum(["correct", "incorrect"]) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await applyScheduledReview({
    userId: user.id,
    entryId: params.id,
    outcome: parsed.data.outcome,
  });
  if (!result.ok) {
    if (result.error === "not_due") {
      return NextResponse.json(
        { error: "not_due", nextReviewAt: result.nextReviewAt },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    mastery: result.mastery,
    srsStage: result.srsStage,
    intervalDays: result.intervalDays,
    nextReviewAt: result.nextReviewAt,
    points: result.points,
  });
}
