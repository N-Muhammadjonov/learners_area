import { NextResponse, type NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { randomActivationItems, resolveActivationItems } from "@/lib/services/writing/activation";
import { activationResolveBody } from "@/lib/writing/activation-schema";

export const dynamic = "force-dynamic";

/** GET /api/writing/activation/items?count=10 — random words from MY Vocabulary (never a demo pool). */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const count = Number(req.nextUrl.searchParams.get("count") ?? 10);
  const items = await randomActivationItems(user.id, Number.isFinite(count) ? count : 10);
  return NextResponse.json({ ok: true, items }, { headers: { "cache-control": "no-store" } });
}

/** POST /api/writing/activation/items {terms} — resolve an own list against MY Vocabulary on the server. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = activationResolveBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Add at least one word.", field: "terms" } }, { status: 400 });
  const items = await resolveActivationItems(user.id, parsed.data.terms);
  return NextResponse.json({ ok: true, items }, { headers: { "cache-control": "no-store" } });
}
