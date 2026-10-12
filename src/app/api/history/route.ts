import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { TIMELINE_KINDS, TIMELINE_MAX_LIMIT, getLearnerTimeline, type TimelineKind } from "@/lib/data/attempt-timeline";

/**
 * GET /api/history
 *
 * The signed-in learner's own cross-skill history (§AD): Reading, Listening, Writing,
 * Speaking, Grammar, Mock and Assignment attempts, newest first, each pointing at the
 * real row it represents.
 *
 * The route reads the ACTOR's id. A `userId` in the query string is only honoured for
 * the caller's own id — a forged id is ignored, never trusted — because there is no
 * staff read of another learner's timeline here: a teacher's view of a student runs
 * through the roster-scoped surfaces, and inventing a second authorization path in a
 * query parameter is how authorization gets lost.
 *
 * Every entry is a projection over the domain attempt tables. This route writes
 * nothing, owns no history, and can therefore never be the reason an attempt changed.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const requested = params.get("userId");
  if (requested && requested !== user.id) {
    // The only id this route can read is the caller's. Anything else is refused, not
    // quietly replaced, so a caller cannot believe they read another learner's history.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const limitParam = params.get("limit");
  const limit = limitParam && /^\d+$/.test(limitParam) ? Math.min(Number(limitParam), TIMELINE_MAX_LIMIT) : undefined;
  const kindsParam = params.get("kinds");
  const kinds = kindsParam
    ? (kindsParam.split(",").map((kind) => kind.trim()).filter((kind): kind is TimelineKind => (TIMELINE_KINDS as readonly string[]).includes(kind)))
    : undefined;
  const date = (value: string | null): Date | null => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  // A kind that cannot be read does not erase the rest of the history, and it is not
  // hidden either: the response names the regions it could not show.
  const unavailable: string[] = [];
  const entries = await getLearnerTimeline(user.id, {
    limit,
    kinds,
    from: date(params.get("from")),
    to: date(params.get("to")),
    onUnavailable: (kind) => unavailable.push(kind),
  });

  return NextResponse.json(
    {
      ok: true,
      entries: entries.map((entry) => ({ ...entry, occurredAt: entry.occurredAt.toISOString(), completedAt: entry.completedAt?.toISOString() ?? null })),
      unavailable,
    },
    { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
  );
}
