import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { saveGeneralProgress } from "@/lib/data/general-reading";
import { blockIfOver } from "@/lib/http/rate-limit";

/**
 * General Reading progress (learning mode). Autosave and "check my answers" for one
 * passage. There is no attempt, no deadline and no lexical lock: General Reading
 * develops reading; IELTS Academic measures it (see src/lib/reading/lexical-policy.ts).
 */
const schema = z.object({
  passageId: z.string().uuid(),
  answers: z.record(z.string().uuid(), z.string().max(500)).refine((value) => Object.keys(value).length <= 60),
  check: z.boolean().default(false),
  start: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const blocked = blockIfOver({ name: "general_reading_progress", limit: 240, windowMs: 60_000 }, `general_reading_progress:${user.id}`);
  if (blocked) return blocked;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const saved = await saveGeneralProgress({ userId: user.id, role: user.role, ...parsed.data });
  if (!saved) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, updatedAt: saved.progress.updatedAt, score: saved.progress.score, total: saved.progress.total, result: saved.result });
}
