import { NextResponse, type NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { randomActivationItems } from "@/lib/services/writing/activation";

export const dynamic = "force-dynamic";

/** GET /api/writing/activation/items?count=10 — random words from MY Vocabulary (never a demo pool). */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const count = Number(req.nextUrl.searchParams.get("count") ?? 10);
  const items = await randomActivationItems(user.id, Number.isFinite(count) ? count : 10);
  return NextResponse.json({ ok: true, items }, { headers: { "cache-control": "no-store" } });
}
