import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getStanding, recentAwards } from "@/lib/services/vocabulary/engine";
import { timed } from "@/lib/observability/timing";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The private leaderboard.
 *
 * The standing is derived from the server-side ledger and ranks only the
 * centre's students. Optional recent award history is isolated and has a
 * dedicated retry mode, so it cannot block or erase the standing panel.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: PRIVATE_NO_STORE });

  const view = req.nextUrl.searchParams.get("view");
  if (view === "awards") {
    try {
      const awards = await timed("vocabulary.entry.recentAwards", () => recentAwards(user.id));
      return NextResponse.json({ ok: true, awards }, { headers: PRIVATE_NO_STORE });
    } catch {
      return NextResponse.json({ ok: false, error: "temporarily_unavailable" }, { status: 503, headers: PRIVATE_NO_STORE });
    }
  }
  if (view === "standing") {
    try {
      const standing = await timed("vocabulary.entry.standing", () => getStanding(user.id));
      return NextResponse.json({ ok: true, ...standing }, { headers: PRIVATE_NO_STORE });
    } catch {
      return NextResponse.json({ ok: false, error: "temporarily_unavailable" }, { status: 503, headers: PRIVATE_NO_STORE });
    }
  }

  const [standingResult, awardsResult] = await Promise.allSettled([
    timed("vocabulary.entry.standing", () => getStanding(user.id)),
    timed("vocabulary.entry.recentAwards", () => recentAwards(user.id)),
  ]);
  if (standingResult.status === "rejected") {
    return NextResponse.json({ ok: false, error: "temporarily_unavailable" }, { status: 503, headers: PRIVATE_NO_STORE });
  }

  return NextResponse.json(
    {
      ok: true,
      ...standingResult.value,
      awards: awardsResult.status === "fulfilled" ? awardsResult.value : [],
      awardsUnavailable: awardsResult.status === "rejected",
    },
    { headers: PRIVATE_NO_STORE },
  );
}
