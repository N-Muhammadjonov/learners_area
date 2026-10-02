import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { and, asc, count, desc, eq, max } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, typingRunTexts, typingRuns, writingModelTexts } from "@/db/schema";
import { liveWhere } from "@/lib/services/cms/publication";
import { computeTypingResult, type TypingResult } from "@/lib/services/writing/typing";

type Database = typeof db;
const AUDIENCE = "learners-area:typing-run";
/** Network slack between the server-issued start and the browser's first keystroke. */
const CLIENT_SLACK_MS = 3_000;

/**
 * Typing on authorized Band 8–9 model texts (§41). The browser sends only
 * { modelTextId, typedText, durationMs, token }. The server loads the
 * canonical body itself, so a tampered client cannot pick its own target, and
 * it measures elapsed time from its own signed start token.
 */
function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET is missing or too short.");
  return new TextEncoder().encode(secret);
}

const live = () => liveWhere({ publicationState: writingModelTexts.publicationState, publishAt: writingModelTexts.publishAt });

export type ModelTextView = { id: string; title: string; taskType: "task1" | "task2"; topic: string; targetBand: number; body: string; wordCount: number };

export async function listWritingModelTexts(database: Database = db): Promise<ModelTextView[]> {
  const rows = await database.select({
    id: writingModelTexts.id, title: writingModelTexts.title, taskType: writingModelTexts.taskType, topic: writingModelTexts.topic,
    targetBand: writingModelTexts.targetBand, body: writingModelTexts.body, wordCount: writingModelTexts.wordCount,
  }).from(writingModelTexts).where(live()).orderBy(asc(writingModelTexts.taskType), asc(writingModelTexts.topic), asc(writingModelTexts.title));
  return rows.map((r) => ({ ...r, targetBand: Number(r.targetBand) }));
}

async function liveText(database: Database, id: string) {
  const [row] = await database.select({ id: writingModelTexts.id, body: writingModelTexts.body }).from(writingModelTexts).where(and(eq(writingModelTexts.id, id), live()));
  return row ?? null;
}

export async function issueTypingToken(userId: string, modelTextId: string, database: Database = db) {
  if (!(await liveText(database, modelTextId))) return null;
  return new SignJWT({ mt: modelTextId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime("2h").sign(key());
}

export type RecordResult =
  | { ok: true; result: TypingResult; runId: string }
  | { ok: false; code: "not_found" | "invalid_token" | "invalid_duration" | "too_long" };

export async function recordModelTextRun(
  userId: string,
  input: { modelTextId: string; typedText: string; durationMs: number; token: string },
  deps: { database?: Database; now?: () => number } = {},
): Promise<RecordResult> {
  const database = deps.database ?? db;
  const now = deps.now ?? (() => Date.now());
  let issuedAtMs: number;
  try {
    const { payload } = await jwtVerify(input.token, key(), { audience: AUDIENCE, subject: userId, currentDate: new Date(now()) });
    if (payload.mt !== input.modelTextId || typeof payload.iat !== "number") return { ok: false, code: "invalid_token" };
    issuedAtMs = payload.iat * 1000;
  } catch {
    return { ok: false, code: "invalid_token" };
  }
  const text = await liveText(database, input.modelTextId);
  if (!text) return { ok: false, code: "not_found" };
  if (input.typedText.length > text.body.length + 200) return { ok: false, code: "too_long" };
  // The server's clock bounds the run: the client's measurement is used only
  // when it is consistent with the server-observed elapsed time.
  const serverElapsed = now() - issuedAtMs;
  const client = input.durationMs;
  const durationMs = client <= serverElapsed + 1_000 && client >= serverElapsed - CLIENT_SLACK_MS ? client : serverElapsed;
  let result: TypingResult;
  try {
    result = computeTypingResult(text.body, input.typedText, Math.round(durationMs));
  } catch {
    return { ok: false, code: "invalid_duration" };
  }
  const runId = await database.transaction(async (tx) => {
    const [run] = await tx.insert(typingRuns).values({
      userId, targetChars: result.targetChars, typedChars: result.typedChars, durationMs: result.durationMs,
      wpm: result.wpm.toFixed(1), accuracy: result.accuracy.toFixed(1),
    }).returning({ id: typingRuns.id });
    await tx.insert(typingRunTexts).values({ runId: run!.id, modelTextId: input.modelTextId, mistakes: result.mistakes });
    await tx.insert(activityEvents).values({ userId, type: "TYPING_RUN_COMPLETED", payload: { wpm: result.wpm, accuracy: result.accuracy, durationMs: result.durationMs } });
    return run!.id;
  });
  return { ok: true, result, runId };
}

export async function typingStats(userId: string, database: Database = db) {
  const [s] = await database.select({ count: count(), bestWpm: max(typingRuns.wpm), bestAccuracy: max(typingRuns.accuracy) })
    .from(typingRuns).where(eq(typingRuns.userId, userId));
  const total = Number(s?.count ?? 0);
  const history = await database.select({
    id: typingRuns.id, createdAt: typingRuns.createdAt, wpm: typingRuns.wpm, accuracy: typingRuns.accuracy, durationMs: typingRuns.durationMs,
    mistakes: typingRunTexts.mistakes, title: writingModelTexts.title,
  }).from(typingRuns)
    .innerJoin(typingRunTexts, eq(typingRunTexts.runId, typingRuns.id))
    .innerJoin(writingModelTexts, eq(writingModelTexts.id, typingRunTexts.modelTextId))
    .where(eq(typingRuns.userId, userId)).orderBy(desc(typingRuns.createdAt)).limit(10);
  return {
    count: total,
    bestWpm: total && s?.bestWpm != null ? Number(s.bestWpm) : null,
    bestAccuracy: total && s?.bestAccuracy != null ? Number(s.bestAccuracy) : null,
    history: history.map((h) => ({ ...h, createdAt: new Date(h.createdAt).toISOString(), wpm: Number(h.wpm), accuracy: Number(h.accuracy) })),
  };
}
