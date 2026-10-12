import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { prepareTypingRun } from "@/lib/services/writing/typing-runs";
import { TYPING_PRESETS } from "@/lib/services/writing/typing";

export const dynamic = "force-dynamic";
const preset = z.union([
  z.literal(0),
  z.literal(TYPING_PRESETS[0]),
  z.literal(TYPING_PRESETS[1]),
  z.literal(TYPING_PRESETS[2]),
  z.literal(TYPING_PRESETS[3]),
]);
const body = z.object({
  preset,
  textId: z.string().uuid().optional(),
  excludeTextId: z.string().uuid().optional(),
}).strict();

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const prepared = await prepareTypingRun(user.id, parsed.data);
  if (!prepared) return NextResponse.json({ error: "no_text" }, { status: 404 });
  return NextResponse.json(prepared, { headers: { "cache-control": "no-store" } });
}
