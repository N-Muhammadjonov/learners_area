import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listDue } from "@/lib/services/vocabulary/engine";
import { timed } from "@/lib/observability/timing";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

/** The Revision view reads only the current due queue, not the learner's library. */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: PRIVATE_NO_STORE });

  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 40);
  const limit = Number.isFinite(requestedLimit) ? Math.min(40, Math.max(1, Math.floor(requestedLimit))) : 40;
  try {
    const due = await timed("vocabulary.entry.due", () => listDue(user.id, limit));
    return NextResponse.json(
      { ok: true, due },
      { headers: PRIVATE_NO_STORE },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "temporarily_unavailable" }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
