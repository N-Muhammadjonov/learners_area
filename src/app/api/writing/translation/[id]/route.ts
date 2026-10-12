import { NextResponse, type NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { getTranslationView } from "@/lib/services/writing/translation";

export const dynamic = "force-dynamic";

/** GET /api/writing/translation/:id — the attempt; only finished sentences carry reference English. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const view = isUuid(id) ? await getTranslationView(user.id, id) : null;
  if (!view) return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  return NextResponse.json({ ok: true, view }, { headers: { "cache-control": "no-store" } });
}
