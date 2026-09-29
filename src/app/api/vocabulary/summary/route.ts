import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { librarySummary } from "@/lib/services/vocabulary/engine";
import { timed } from "@/lib/observability/timing";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

/** A small, independently retryable aggregate for Vocabulary's summary tiles. */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: PRIVATE_NO_STORE });

  try {
    const summary = await timed("vocabulary.entry.summary", () => librarySummary(user.id));
    return NextResponse.json(
      { ok: true, summary },
      { headers: PRIVATE_NO_STORE },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "temporarily_unavailable" }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
