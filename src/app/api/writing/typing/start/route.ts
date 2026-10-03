import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { issueTypingToken } from "@/lib/services/writing/typing-runs";
import { TYPING_PRESETS } from "@/lib/services/writing/typing";

export const dynamic = "force-dynamic";
/** presetSeconds: 60 | 120 | 180 for a timed run; null/absent = untimed full text. Anything else is refused. */
const body = z.object({
  modelTextId: z.string().uuid(),
  presetSeconds: z.union([z.literal(TYPING_PRESETS[0]), z.literal(TYPING_PRESETS[1]), z.literal(TYPING_PRESETS[2])]).nullable().optional(),
}).strict();

/** POST /api/writing/typing/start — a signed, server-timed start for one model text. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Choose a model text and a supported duration." } }, { status: 400 });
  const presetSeconds = parsed.data.presetSeconds ?? null;
  const token = await issueTypingToken(user.id, parsed.data.modelTextId, undefined, presetSeconds);
  if (!token) return NextResponse.json({ error: { code: "not_found", message: "This text is not available." } }, { status: 404 });
  return NextResponse.json({ ok: true, token, presetSeconds }, { headers: { "cache-control": "no-store" } });
}
