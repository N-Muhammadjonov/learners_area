import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { requireActiveUser } from "@/lib/auth/current-user";
import { AI_MODES } from "@/lib/speaking/ai-session";
import { createSpeakingAiSession, readSpeakingAiSession } from "@/lib/data/speaking-ai-sessions";

const createSchema = z.object({ mode: z.enum(AI_MODES as ["full", "part1", "part2", "part3"]) }).strict();
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await createSpeakingAiSession(db, user.id, parsed.data.mode);
  return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "no_questions" }, { status: 409 });
}
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const result = await readSpeakingAiSession(db, user.id);
  return NextResponse.json({ ok: true, ...(result ?? { session: null, items: [] }) });
}
