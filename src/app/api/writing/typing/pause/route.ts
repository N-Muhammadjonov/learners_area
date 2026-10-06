import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { togglePreparedTypingPause } from "@/lib/services/writing/typing-runs";

export const dynamic = "force-dynamic";

const body = z.object({
  runToken: z.string().min(20).max(2500),
  action: z.enum(["pause", "resume"]),
}).strict();

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await togglePreparedTypingPause(
    user.id,
    parsed.data.runToken,
    parsed.data.action,
  );
  if (!result) return NextResponse.json({ error: "invalid_token" }, { status: 403 });

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
