import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getStanding, recentAwards } from "@/lib/services/vocabulary/engine";

/**
 * The private leaderboard.
 *
 * Private means two things: it is only visible to an approved account, and it
 * ranks the centre's own students — never a global board, never somebody else's
 * data. The numbers are aggregated from the server-side ledger on every request;
 * there is no score to post.
 */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [standing, awards] = await Promise.all([getStanding(user.id), recentAwards(user.id)]);
  return NextResponse.json({ ok: true, ...standing, awards });
}
