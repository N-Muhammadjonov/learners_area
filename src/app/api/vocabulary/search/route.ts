import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { searchLibrary } from "@/lib/services/vocabulary/engine";

/**
 * GET /api/vocabulary/search?q=…
 *
 * The live dropdown behind the long search box. It searches the CALLER'S OWN
 * library — there is no parameter for whose words to look at, so one student can
 * never read another student's list. English and Uzbek are searchable; the
 * ranking lives in the engine so the UI cannot invent a different order.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const query = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  if (query.trim().length === 0) return NextResponse.json({ ok: true, results: [] });

  const hits = await searchLibrary(user.id, query);
  return NextResponse.json({
    ok: true,
    query,
    results: hits.map((hit) => ({
      id: hit.row.id,
      term: hit.row.term,
      definitionEn: hit.row.definitionEn,
      translationUz: hit.row.translationUz,
      mastery: hit.row.mastery,
      srsStage: hit.row.srsStage,
      nextReviewAt: hit.row.nextReviewAt,
      match: hit.match,
    })),
  });
}
