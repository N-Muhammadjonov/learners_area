import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { startStealing } from "@/lib/services/writing/stealing";

export const dynamic = "force-dynamic";
const body = z.object({ modelTextId: z.string().uuid() }).strict();

/** POST /api/writing/stealing/sessions — start (or resume) the 7-step workflow for one authorized model text. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Choose a model text." } }, { status: 400 });
  const view = await startStealing(user.id, parsed.data.modelTextId);
  if (!view) return NextResponse.json({ error: { code: "not_found", message: "This model text is not available." } }, { status: 404 });
  return NextResponse.json({ ok: true, id: view.id });
}
