import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { gameSet, loadSelfAssessments, recordGameAnswer } from "@/lib/services/vocabulary/engine";
import { uniqueGameRound } from "@/lib/services/vocabulary/game-round";
import { isGameId } from "@/lib/services/vocabulary/game-routes";

/**
 * The casual games API.
 *
 * GET  ?set=weak&folderId=…  the words a set offers (same library, a filter)
 * POST {entryId, set, gameId, submission} one answer, graded by the server
 *
 * The request carries WHAT the student answered, never whether it was right. The
 * server looks the word up and decides, so a hand-made request that claims
 * success earns nothing. A submission the server cannot check (a flashcard
 * self-assessment) is recorded as practice only.
 *
 * A verified correct answer earns one point without changing SRS. The selected
 * set and word membership are re-derived on the server; client score flags and
 * point values are never accepted.
 */
const SETS = ["all", "due", "weak", "reading", "listening", "topic", "folder", "assigned"] as const;

export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("set") ?? "due";
  const key = (SETS as readonly string[]).includes(raw) ? (raw as (typeof SETS)[number]) : "due";
  const folderId = req.nextUrl.searchParams.get("folderId") ?? undefined;
  const topicPack = req.nextUrl.searchParams.get("topicPack") ?? undefined;
  const parsedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 24);
  const limit = Number.isFinite(parsedLimit) ? Math.min(500, Math.max(1, Math.floor(parsedLimit))) : 24;
  const rawGameId = req.nextUrl.searchParams.get("game");
  if (rawGameId && !isGameId(rawGameId)) return NextResponse.json({ error: "invalid_game" }, { status: 400 });
  const gameId = rawGameId && isGameId(rawGameId) ? rawGameId : null;

  const requestedSet = await gameSet(user.id, key, { folderId, topicPack, limit: 500 });
  const random = req.nextUrl.searchParams.get("random") === "1";
  const eligible = gameId === "translation"
    ? requestedSet.words.filter((word) => Boolean(word.translationUz?.trim()))
    : gameId === "race"
      ? requestedSet.words.filter((word) => Boolean(word.term.trim() && word.definitionEn.trim()))
      : requestedSet.words;
  const selected = gameId
    ? random ? uniqueGameRound(eligible, limit) : eligible.slice(0, limit)
    : [];
  const words = selected.map((word) => ({
    id: word.id,
    term: word.term,
    definitionEn: word.definitionEn,
    ...(gameId === "cards" ? { partOfSpeech: word.partOfSpeech, translationUz: word.translationUz, collocations: word.collocations, exampleSentence: word.exampleSentence } : {}),
    ...(gameId === "race" ? { translationUz: word.translationUz, sourceType: word.sourceType } : {}),
    ...(gameId === "gap" || gameId === "builder" ? { exampleSentence: word.exampleSentence } : {}),
    ...(gameId === "translation" ? { translationUz: word.translationUz, acceptedTranslations: word.acceptedTranslations, collocations: word.collocations, exampleSentence: word.exampleSentence } : {}),
  }));
  // The flashcard deck is the one game with a self-assessment: its previous
  // verdicts are read back from the recorded practice rows so the marks a
  // learner left behind survive a reload. Other games get no such field.
  const selfAssessments = gameId === "cards"
    ? await loadSelfAssessments(user.id, words.map((word) => word.id))
    : null;
  return NextResponse.json({
    ok: true,
    ...requestedSet,
    words,
    count: words.length,
    ...(selfAssessments ? { selfAssessments } : {}),
  });
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
  z.object({ kind: z.literal("pair"), pairEntryId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("self"), known: z.boolean() }).strict(),
]);

const answerSchema = z
  .object({
    entryId: z.string().uuid(),
    set: z.enum(SETS),
    gameId: z.enum(["cards", "choice", "match", "gap", "race", "translation", "builder"]),
    folderId: z.string().uuid().optional(),
    topicPack: z.string().max(100).optional(),
    submission: submissionSchema,
  })
  .strict();

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await recordGameAnswer({
    userId: user.id,
    entryId: parsed.data.entryId,
    submission: parsed.data.submission,
    setKey: parsed.data.set,
    gameId: parsed.data.gameId,
    folderId: parsed.data.folderId,
    topicPack: parsed.data.topicPack,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });

  return NextResponse.json(result);
}
