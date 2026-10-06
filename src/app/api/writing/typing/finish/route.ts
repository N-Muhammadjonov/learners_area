import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { finishPreparedTypingRun, typingStats } from "@/lib/services/writing/typing-runs";

export const dynamic = "force-dynamic";
const body = z.object({
  runToken: z.string().min(20).max(2500),
  typedWords: z.array(z.string().max(80)).min(1).max(1000),
  samples: z.array(z.number().int().min(0).max(100000)).max(1900),
}).strict();

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await finishPreparedTypingRun(user.id, parsed.data);
  if (!result.ok) {
    const status =
      result.code === "invalid_token" ? 403 :
      result.code === "not_found" ? 404 :
      result.code === "too_early" ? 409 :
      result.code === "bad_submission" ? 422 : 409;
    return NextResponse.json({ error: result.code }, { status });
  }

  try {
    const stats = await typingStats(user.id);
    return NextResponse.json({
      run: result.result,
      summary: { count: stats.count, bestWpm: stats.bestWpm, bestAccuracy: stats.bestAccuracy },
      history: stats.history,
    });
  } catch (error) {
    // Persistence already succeeded. Never turn a saved run into a red error
    // screen just because the non-critical history refresh is temporarily stale.
    console.warn("[writing-typing] saved run, history refresh unavailable", {
      userId: user.id,
      runId: result.result.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ run: result.result });
  }
}
