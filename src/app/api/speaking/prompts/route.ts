import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingPrompts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { liveWhere } from "@/lib/services/cms/publication";

/**
 * GET /api/speaking/prompts — the prompts a student can practise against.
 *
 * Only prompts that are live right now are listed (the publication rule, not the
 * older boolean). Order is by part then insertion, so the practice screen shows
 * a stable, predictable sequence.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const part = req.nextUrl.searchParams.get("part");
  const rows = await db.query.speakingPrompts.findMany({
    where: liveWhere({
      publicationState: speakingPrompts.publicationState,
      publishAt: speakingPrompts.publishAt,
    }),
    orderBy: [asc(speakingPrompts.part), asc(speakingPrompts.createdAt)],
  });

  const filtered = part ? rows.filter((r) => r.part === part) : rows;
  return NextResponse.json({ ok: true, prompts: filtered });
}
