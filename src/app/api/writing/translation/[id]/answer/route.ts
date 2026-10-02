import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { submitTranslationAnswer } from "@/lib/services/writing/translation";
import { writingAiReady } from "@/lib/writing/ai-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const body = z.object({ position: z.number().int().min(1).max(40), answer: z.string().max(1200) }).strict();

/** POST /api/writing/translation/:id/answer — check the current sentence (exact → AI). Never auto-retried. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!isUuid(id) || !parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Write your English sentence first.", field: "answer" } }, { status: 400 });
  const r = await submitTranslationAnswer(user.id, id, parsed.data.position, parsed.data.answer, await getLocale(), { aiReady: writingAiReady() });
  if (!r.ok) {
    const status = r.code === "not_found" ? 404 : r.code === "empty" ? 400 : 409;
    return NextResponse.json({ error: { code: r.code, message: r.code === "not_current" ? "This sentence is not the current one." : "Could not check this sentence." } }, { status });
  }
  return NextResponse.json({ ok: true, verdict: r.verdict, view: r.view });
}
