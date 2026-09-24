import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingPrompts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";

/**
 * GET /api/speaking/prompts — the prompts a student can practise against.
 *
 * Only active prompts are listed. Order is by part then insertion, so the
 * practice screen shows a stable, predictable sequence.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const part = req.nextUrl.searchParams.get("part");
  const where = part && ["part1", "part2", "part3", "general"].includes(part)
    ? eq(speakingPrompts.isActive, true)
    : eq(speakingPrompts.isActive, true);

  void where;
  const rows = await db.query.speakingPrompts.findMany({
    where: eq(speakingPrompts.isActive, true),
    orderBy: [asc(speakingPrompts.part), asc(speakingPrompts.createdAt)],
  });

  const filtered = part ? rows.filter((r) => r.part === part) : rows;
  return NextResponse.json({ ok: true, prompts: filtered });
}
