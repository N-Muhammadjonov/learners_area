import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { fullListeningDetail } from "@/lib/data/full-listening";
import { enrichTerm } from "@/lib/services/lexical/enrichment";
import { isUuid } from "@/lib/validation/ids";
const headers = { "Cache-Control": "private, no-store" };
/** Read-only catalogue lookup for an accessible Listening source. No guessed meanings. */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401, headers },
    );
  const sourceId = req.nextUrl.searchParams.get("sourceId") ?? "";
  const term = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!isUuid(sourceId) || !term || term.length > 120)
    return NextResponse.json(
      { error: "invalid_input" },
      { status: 400, headers },
    );
  try {
    const detail = await fullListeningDetail(sourceId, user.role);
    if (!detail)
      return NextResponse.json(
        { error: "source_not_found" },
        { status: 404, headers },
      );
    const entry = await enrichTerm(term);
    return NextResponse.json(
      {
        contextual: entry
          ? {
              definitionEn: entry.definitionEn,
              translationUz: entry.translationUz,
              verificationStatus: null,
              sourceLabel: entry.sourceLabel,
            }
          : null,
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers },
    );
  }
}
