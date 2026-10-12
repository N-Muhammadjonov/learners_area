import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { startPractice, submitPractice } from "@/lib/services/writing/stealing";
import { writingAiReady } from "@/lib/writing/ai-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const unauth = () => NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });

/** GET /api/writing/stealing/practice?patternId= — a NEW topic (never the pattern's own). */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return unauth();
  const id = req.nextUrl.searchParams.get("patternId") ?? "";
  if (!isUuid(id)) return NextResponse.json({ error: { code: "invalid_input", message: "Unknown pattern." } }, { status: 400 });
  const r = await startPractice(id);
  if (!r) return NextResponse.json({ error: { code: "not_found", message: "Unknown pattern." } }, { status: 404 });
  return NextResponse.json({ ok: true, ...r }, { headers: { "cache-control": "no-store" } });
}

const body = z.object({ patternId: z.string().uuid(), newTopic: z.string().min(1).max(120), answer: z.string().min(1).max(800) }).strict();

/** POST — near-copy guard, then the external AI pattern check. Never auto-retried. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return unauth();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Write your adapted sentence.", field: "answer" } }, { status: 400 });
  if (!(await writingAiReady())) return NextResponse.json({ error: { code: "unavailable", message: "AI checking is not available right now.", retryable: false } }, { status: 503 });
  const r = await submitPractice(user.id, await getLocale(), parsed.data);
  if (!r.ok) {
    const status = r.code === "not_found" ? 404 : r.code === "unavailable" || r.code === "failed" ? 503 : 400;
    return NextResponse.json({ error: { code: r.code, message: "Could not check this sentence.", retryable: r.code === "failed" } }, { status });
  }
  return NextResponse.json(r);
}
