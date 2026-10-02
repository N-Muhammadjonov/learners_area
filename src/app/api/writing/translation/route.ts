import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { startTranslationAttempt } from "@/lib/services/writing/translation";
import { TRANSLATION_QUESTION_TYPES } from "@/lib/writing/translation-rules";
import { safeWritingQuery } from "@/lib/writing/safe-query";

export const dynamic = "force-dynamic";
const body = z.union([
  z.object({ setId: z.string().uuid() }).strict(),
  z.object({ random: z.object({ questionType: z.enum(TRANSLATION_QUESTION_TYPES).optional(), targetBand: z.union([z.literal(6), z.literal(7), z.literal(8)]).optional() }).strict() }).strict(),
]);

/** POST /api/writing/translation — start (or resume) an attempt on a chosen or random reviewed set. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Choose a topic or a random essay." } }, { status: 400 });
  const r = await safeWritingQuery(() => startTranslationAttempt(user.id, parsed.data));
  if (!r.ok) return NextResponse.json({ error: { code: "not_migrated", message: "Translation is not available yet." } }, { status: 503 });
  if (!r.value.ok) return NextResponse.json({ error: { code: r.value.code, message: "No published essay matches this choice." } }, { status: 404 });
  return NextResponse.json({ ok: true, id: r.value.attemptId, resumed: r.value.resumed });
}
