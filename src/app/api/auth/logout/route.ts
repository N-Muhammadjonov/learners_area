import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { revokeSession } from "@/lib/auth/session-authority";

/**
 * POST /api/auth/logout
 *
 * Signs the visitor out for good. A partitioned cookie is not removed by a plain
 * expiry — the browser needs the same partition key back — so the deletion is
 * written with the attributes this request's transport used, and the
 * pre-partition shape of the cookie is retired as well (see clearSessionCookies).
 */
export async function POST(req: NextRequest) {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  const session = raw ? await verifySessionToken(raw) : null;
  if (session) {
    try {
      await revokeSession({ userId: session.sub, authVersion: session.authVersion,
        sessionKey: session.sessionKey, expiresAt: session.expiresAt });
    } catch {
      // Preserve the cookie so logout can be retried. Never claim revocation
      // succeeded if the authoritative store could not commit it.
      return NextResponse.json({ error: "logout_unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  const res = NextResponse.json({ ok: true });
  res.headers.set("Cache-Control", "private, no-store");
  clearSessionCookies(res, req);
  return res;
}
