import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { advanceStealing } from "@/lib/services/writing/stealing";

export const dynamic = "force-dynamic";
const text = z.string().max(6000);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }).strict(),
  z.object({ action: z.literal("brainstorm"), text }).strict(),
  z.object({ action: z.literal("draft"), text }).strict(),
  z.object({ action: z.literal("analyse"), patternIds: z.array(z.string().uuid()).min(1).max(30) }).strict(),
  z.object({ action: z.literal("compare"), text }).strict(),
  z.object({ action: z.literal("recall"), patternId: z.string().uuid(), attempt: z.string().max(300) }).strict(),
  z.object({ action: z.literal("rewrite"), text }).strict(),
]);

/** POST /api/writing/stealing/sessions/:id — complete the current step (server validates and unlocks the next). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Check your answer." } }, { status: 400 });
  const r = await advanceStealing(user.id, id, parsed.data);
  if (!r.ok) return NextResponse.json({ error: { code: r.code, message: "Step not completed." } }, { status: r.code === "not_found" ? 404 : r.code === "wrong_step" ? 409 : 400 });
  return NextResponse.json(r);
}
