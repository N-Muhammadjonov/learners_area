import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { startPreparedTypingRun } from "@/lib/services/writing/typing-runs";

export const dynamic = "force-dynamic";
const body = z.object({ token: z.string().min(20).max(2500) }).strict();

/** First valid keystroke: exchange the short prep token for a server-timed run token. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) {
    return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in again." } }, { status: 401 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_input", message: "Invalid typing preparation." } }, { status: 400 });
  }
  const runToken = await startPreparedTypingRun(user.id, parsed.data.token);
  if (!runToken) {
    return NextResponse.json({ error: { code: "invalid_token", message: "This typing preparation expired." } }, { status: 403 });
  }
  return NextResponse.json({ ok: true, runToken }, { headers: { "cache-control": "no-store" } });
}
