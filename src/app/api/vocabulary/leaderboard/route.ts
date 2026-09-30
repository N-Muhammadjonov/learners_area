import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getStanding, recentAwards } from "@/lib/services/vocabulary/engine";
import { timed } from "@/lib/observability/timing";
import { safeDatabaseDiagnostic } from "@/lib/observability/errors";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };
const STANDING_ERROR_CODE = "vocabulary_standing_unavailable";
const AWARDS_ERROR_CODE = "vocabulary_awards_unavailable";

type LeaderboardResource = "standing" | "awards";

function queryStage(error: unknown, fallback: string): string {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const stage = (current as { leaderboardStage?: unknown }).leaderboardStage;
    if (typeof stage === "string" && /^(standing_totals|standing_streak_days|awards_recent)$/.test(stage)) return stage;
    current = (current as { cause?: unknown }).cause;
  }
  return fallback;
}

/** Log actionable, non-secret diagnostics; never serialize a driver message or SQL. */
function reportUnavailable(resource: LeaderboardResource, error: unknown, fallbackStage: string) {
  const code = resource === "standing" ? STANDING_ERROR_CODE : AWARDS_ERROR_CODE;
  const diagnostic = safeDatabaseDiagnostic(error);
  const sqlState = diagnostic.sqlState ? ` sqlstate=${diagnostic.sqlState}` : "";
  console.error(`[vocabulary.leaderboard] http=503 code=${code} stage=${queryStage(error, fallbackStage)} errorClass=${diagnostic.errorClass}${sqlState}`);
}

/**
 * The private leaderboard.
 *
 * Standing comes only from the server-side Vocabulary ledger and is limited to
 * student accounts. Recent award history is optional and independently
 * retryable: its failure cannot erase a valid standing result.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: PRIVATE_NO_STORE });

  const view = req.nextUrl.searchParams.get("view");
  if (view === "awards") {
    try {
      const awards = await timed("vocabulary.entry.recentAwards", () => recentAwards(user.id));
      return NextResponse.json({ ok: true, awards }, { headers: PRIVATE_NO_STORE });
    } catch (error) {
      reportUnavailable("awards", error, "awards_recent");
      return NextResponse.json({ ok: false, error: "temporarily_unavailable", code: AWARDS_ERROR_CODE }, { status: 503, headers: PRIVATE_NO_STORE });
    }
  }
  if (view === "standing") {
    try {
      const standing = await timed("vocabulary.entry.standing", () => getStanding(user.id));
      return NextResponse.json({ ok: true, ...standing }, { headers: PRIVATE_NO_STORE });
    } catch (error) {
      reportUnavailable("standing", error, "standing_totals");
      return NextResponse.json({ ok: false, error: "temporarily_unavailable", code: STANDING_ERROR_CODE }, { status: 503, headers: PRIVATE_NO_STORE });
    }
  }

  const [standingResult, awardsResult] = await Promise.allSettled([
    timed("vocabulary.entry.standing", () => getStanding(user.id)),
    timed("vocabulary.entry.recentAwards", () => recentAwards(user.id)),
  ]);
  if (standingResult.status === "rejected") {
    reportUnavailable("standing", standingResult.reason, "standing_totals");
    return NextResponse.json({ ok: false, error: "temporarily_unavailable", code: STANDING_ERROR_CODE }, { status: 503, headers: PRIVATE_NO_STORE });
  }
  if (awardsResult.status === "rejected") reportUnavailable("awards", awardsResult.reason, "awards_recent");

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
