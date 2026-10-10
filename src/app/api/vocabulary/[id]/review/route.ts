import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { applyScheduledReview } from "@/lib/services/vocabulary/engine";
import { vocabularyReviewHttpSchema } from "@/lib/services/vocabulary/review-input";

/**
 * POST /api/vocabulary/:id/review — one scheduled revision.
 *
 * This is the ONLY endpoint that moves the official ladder. The student reports
 * whether they recalled the word; the server applies the 1/3/7/16/35 schedule,
 * recomputes mastery, and writes one point to the ledger (idempotently, keyed by
 * the scheduled due slot).
 */
const schema = vocabularyReviewHttpSchema;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await applyScheduledReview({
    userId: user.id,
    entryId: id,
    outcome: parsed.data.outcome,
  });
  if (!result.ok) {
    if (result.error === "not_due") {
      return NextResponse.json(
        { error: "not_due", nextReviewAt: result.nextReviewAt },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: result.error }, {
      status: result.error === "unauthenticated" ? 401 : result.error === "invalid_input" ? 400 : 404,
    });
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
