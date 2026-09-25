import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies } from "@/lib/auth/session";

/**
 * POST /api/auth/logout
 *
 * Signs the visitor out for good. A partitioned cookie is not removed by a plain
 * expiry — the browser needs the same partition key back — so the deletion is
 * written with the attributes this request's transport used, and the
 * pre-partition shape of the cookie is retired as well (see clearSessionCookies).
 */
export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res, req);
  return res;
}
