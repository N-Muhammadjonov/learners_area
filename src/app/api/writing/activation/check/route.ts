import { NextResponse, type NextRequest } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { checkActivation } from "@/lib/services/writing/activation";
import { writingAiReady } from "@/lib/writing/ai-readiness";
import { activationCheckBody as body } from "@/lib/writing/activation-schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/writing/activation/check — external-AI usage check for one item. Never auto-retried. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Write a sentence with the item.", field: "answer" } }, { status: 400 });
  if (!(await writingAiReady())) return NextResponse.json({ error: { code: "unavailable", message: "AI checking is not available right now.", retryable: false } }, { status: 503 });
  const r = await checkActivation(user.id, await getLocale(), parsed.data);
  if (!r.ok) {
    const status = r.code === "not_found" ? 404 : r.code === "unavailable" || r.code === "failed" ? 503 : 400;
    return NextResponse.json({ error: { code: r.code, message: "Could not check this sentence.", retryable: r.code === "failed" } }, { status });
  }
  return NextResponse.json(r);
}
