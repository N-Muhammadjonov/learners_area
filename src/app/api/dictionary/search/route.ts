import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { pinnedRelease, searchDictionary } from "@/lib/dictionary/store";
import { consume, RULES } from "@/lib/http/rate-limit";
import { apiError, privateHeaders } from "@/lib/dictionary/api";
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user)
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401, headers: privateHeaders },
    );
  const limit = consume(RULES.vocabularySearch, "dictionary:" + user.id);
  if (!limit.ok)
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          ...privateHeaders,
          "Retry-After": String(limit.retryAfterSeconds),
        },
      },
    );
  const q = req.nextUrl.searchParams.get("q") ?? "",
    direction = req.nextUrl.searchParams.get("direction") ?? "EN";
  if (q.length > 80 || !["EN", "UZ"].includes(direction))
    return NextResponse.json(
      { error: "invalid_input" },
      { status: 400, headers: privateHeaders },
    );
  try {
    const release_id = await pinnedRelease(
      req.nextUrl.searchParams.get("release_id"),
    );
    return NextResponse.json(
      {
        release_id,
        results: await searchDictionary(
          q,
          direction as "EN" | "UZ",
          release_id,
        ),
      },
      { headers: privateHeaders },
    );
  } catch (e) {
    return apiError(e);
  }
}
