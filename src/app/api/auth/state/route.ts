import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One authoritative read only when the owner changes access, or stream
 * reconnects; never polled on every click. This response grants no capability.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, {
    status: 401,
    headers: { "Cache-Control": "private, no-store" },
  });
  return NextResponse.json({
    ok: true,
    role: user.role,
    accountStatus: user.accountStatus,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
