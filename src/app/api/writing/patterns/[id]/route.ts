import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { setPatternSaved } from "@/lib/services/writing/topic-vocabulary";

export const dynamic = "force-dynamic";
const body = z.object({ saved: z.boolean() }).strict();

/** PUT /api/writing/patterns/:id — save or remove a published pattern from my pattern bank. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Could not save." } }, { status: 400 });
  const ok = await setPatternSaved(user.id, id, parsed.data.saved);
  if (!ok) return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  return NextResponse.json({ ok: true, saved: parsed.data.saved });
}
