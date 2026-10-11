import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { AI_MODES, type AiMode } from "@/lib/speaking/ai-session";
import { selectExaminerScript } from "@/lib/data/speaking-practice";

/**
 * GET /api/speaking/ai/script?mode=full|part1|part2|part3 — the examiner's script.
 *
 * Server-authoritative exam selection. The session used to build its script in the browser from the
 * complete published bank, which is why the page had to ship the whole corpus. Selecting from only the
 * first bounded page was explicitly not acceptable: it would bias every exam toward whichever prompts
 * sort first and make later ones unreachable, trading a performance defect for a fairness one. So the
 * draw happens here against the full corpus while every response stays bounded — see
 * `selectExaminerScript` for how the topic-then-question sampling stays unbiased.
 *
 * Nothing is invented and no draft can appear: publication state and the channel's `availableIn`
 * eligibility are in every predicate, and a part with no published prompts is simply absent from the
 * script, exactly as the in-memory version behaved.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("mode") ?? "full";
  if (!(AI_MODES as readonly string[]).includes(raw)) {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }
  const mode = raw as AiMode;

  const script = await selectExaminerScript({ mode, channel: "ai" });
  return NextResponse.json({ mode, script }, { headers: { "cache-control": "no-store" } });
}
