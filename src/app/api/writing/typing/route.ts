import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listTypingRuns, typingSummary } from "@/lib/data/writing";
import { recordModelTextRun, typingStats } from "@/lib/services/writing/typing-runs";

const schema = z.object({
  modelTextId: z.string().uuid(),
  typedText: z.string().max(8200),
  durationMs: z.number().int().positive(),
  token: z.string().min(20).max(2000),
}).strict();

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [summary, runs] = await Promise.all([typingSummary(user.id), listTypingRuns(user.id)]);
  return NextResponse.json({ summary, runs: runs.map((r) => ({ ...r, wpm: Number(r.wpm), accuracy: Number(r.accuracy) })) });
}

/**
 * Record a typing run on a model text. The client names the model text and
 * sends what was typed; the server loads the canonical body and computes every
 * metric itself. A client-supplied target text is no longer accepted.
 */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_input", message: "Could not record this run." } }, { status: 400 });
  const r = await recordModelTextRun(user.id, parsed.data);
  if (!r.ok) {
    const status = r.code === "not_found" ? 404 : r.code === "expired" ? 409 : 400;
    return NextResponse.json({ error: { code: r.code, message: r.code === "invalid_duration" ? "The run was too short to measure." : "Could not record this run." } }, { status });
  }
  const stats = await typingStats(user.id);
  return NextResponse.json({ run: { id: r.runId, ...r.result, presetSeconds: r.presetSeconds }, summary: { count: stats.count, bestWpm: stats.bestWpm, bestAccuracy: stats.bestAccuracy }, history: stats.history });
}
