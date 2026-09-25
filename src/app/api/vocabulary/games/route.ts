import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { gameSet, recordGameAnswer } from "@/lib/services/vocabulary/engine";

/**
 * The casual games API.
 *
 * GET  ?set=weak&folderId=…   the words a set offers (same library, a filter)
 * POST {entryId, correct, set} one answer, scored server-side
 *
 * The answer endpoint deliberately cannot move the spaced-repetition ladder: it
 * awards a small casual point when the word was one the student was due to
 * practise, and nothing otherwise. Official progress happens only in scheduled
 * revision.
 */
const SETS = ["all", "due", "weak", "reading", "listening", "topic", "folder", "assigned"] as const;

export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("set") ?? "due";
  const key = (SETS as readonly string[]).includes(raw) ? (raw as (typeof SETS)[number]) : "due";
  const folderId = req.nextUrl.searchParams.get("folderId") ?? undefined;
  const topicPack = req.nextUrl.searchParams.get("topicPack") ?? undefined;

  const set = await gameSet(user.id, key, { folderId, topicPack });
  return NextResponse.json({ ok: true, ...set });
}

const answerSchema = z.object({
  entryId: z.string().uuid(),
  correct: z.boolean(),
  set: z.enum(SETS),
  /** The server decides eligibility; this is only a hint and is re-checked. */
  eligible: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // Eligibility is derived here from the real schedule, not trusted from the body.
  const set = await gameSet(user.id, parsed.data.set, { limit: 500 });
  const inSet = set.words.find((word) => word.id === parsed.data.entryId);
  if (!inSet) return NextResponse.json({ error: "not_in_set" }, { status: 404 });
  const eligible = inSet.nextReviewAt.getTime() <= Date.now() || parsed.data.set === "weak";

  const result = await recordGameAnswer({
    userId: user.id,
    entryId: parsed.data.entryId,
    correct: parsed.data.correct,
    setKey: parsed.data.set,
    eligible,
  });

  return NextResponse.json({ ok: true, ...result });
}
