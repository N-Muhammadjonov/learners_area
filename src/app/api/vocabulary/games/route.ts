import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { gameSet, recordGameAnswer } from "@/lib/services/vocabulary/engine";

/**
 * The casual games API.
 *
 * GET  ?set=weak&folderId=…  the words a set offers (same library, a filter)
 * POST {entryId, set, submission}  one answer, graded by the server
 *
 * The request carries WHAT the student answered, never whether it was right. The
 * server looks the word up and decides, so a hand-made request that claims
 * success earns nothing. A submission the server cannot check (a flashcard
 * self-assessment) is recorded as practice only.
 *
 * The answer endpoint deliberately cannot move the spaced-repetition ladder: it
 * awards a small casual point when the word is one the student was due to
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

/**
 * A submission, not a verdict. `strict()` matters: a body that still carries the
 * retired `correct` field is rejected outright rather than being silently
 * accepted, so a client that has not been updated cannot keep asserting its own
 * score.
 */
const submissionSchema = z.discriminatedUnion("kind", [
  // An empty answer is allowed and simply graded wrong: a student who presses
  // "check" on an empty box should see the same verdict the browser shows, not
  // an error.
  z.object({ kind: z.literal("spelling"), text: z.string().max(300) }).strict(),
  z.object({ kind: z.literal("sentence"), text: z.string().max(600) }).strict(),
  z.object({ kind: z.literal("self"), known: z.boolean() }).strict(),
]);

const answerSchema = z
  .object({
    entryId: z.string().uuid(),
    set: z.enum(SETS),
    submission: submissionSchema,
    /** Eligibility is derived server-side; a hint from the body is ignored. */
    eligible: z.boolean().optional(),
  })
  .strict();

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
    submission: parsed.data.submission,
    setKey: parsed.data.set,
    eligible,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });

  return NextResponse.json(result);
}
