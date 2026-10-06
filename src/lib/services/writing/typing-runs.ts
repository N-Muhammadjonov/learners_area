import "server-only";
import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { and, asc, count, desc, eq, isNull, lte, max, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityEvents,
  typingRunTexts,
  typingRuns,
  typingTexts,
  writingModelTexts,
} from "@/db/schema";
import { liveWhere } from "@/lib/services/cms/publication";
import {
  computeTypingResult,
  computeWordTypingMetrics,
  isTypingPreset,
  splitTypingWords,
  validateTypingSubmission,
  type TypingMetrics,
  type TypingPreset,
  type TypingResult,
} from "@/lib/services/writing/typing";

type Database = typeof db;

const LEGACY_AUDIENCE = "learners-area:typing-run";
const PREP_AUDIENCE = "learners-area:typing-prep";
const RUN_AUDIENCE = "learners-area:typing-live";
const CLIENT_SLACK_MS = 3_000;
export const TIMED_SUBMIT_GRACE_MS = 30_000;

function key() {
  // Reuse the app's existing signing secret rather than introducing a second
  // credential solely for Typing. It is server-only and never reaches the client.
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET is missing or too short.");
  return new TextEncoder().encode(secret);
}

const legacyLive = () =>
  liveWhere({
    publicationState: writingModelTexts.publicationState,
    publishAt: writingModelTexts.publishAt,
  });

const typingLive = () =>
  and(
    eq(typingTexts.publicationState, "published"),
    eq(typingTexts.language, "en"),
    or(isNull(typingTexts.publishAt), lte(typingTexts.publishAt, new Date())),
  );

export type TypingTextView = {
  id: string;
  externalId: string;
  title: string;
  body: string;
  wordCount: number;
  difficulty: string | null;
  topic: string | null;
};

export async function listTypingTexts(database: Database = db): Promise<TypingTextView[]> {
  return database
    .select({
      id: typingTexts.id,
      externalId: typingTexts.externalId,
      title: typingTexts.title,
      body: typingTexts.body,
      wordCount: typingTexts.wordCount,
      difficulty: typingTexts.difficulty,
      topic: typingTexts.topic,
    })
    .from(typingTexts)
    .where(typingLive())
    .orderBy(asc(typingTexts.externalId));
}

function normalizePreset(value: unknown): TypingPreset | 0 | null {
  if (value === 0) return 0;
  if (isTypingPreset(value)) return value;
  return null;
}

/**
 * Pick one canonical Learners Area typing text and bind it to the learner +
 * chosen duration before any keystroke is accepted.
 */
export async function prepareTypingRun(
  userId: string,
  input: { preset: TypingPreset | 0; textId?: string; excludeTextId?: string },
  deps: { database?: Database; now?: () => number } = {},
) {
  const database = deps.database ?? db;
  const now = deps.now ?? (() => Date.now());
  const all = await listTypingTexts(database);
  let text: TypingTextView | undefined;
  if (input.textId) {
    text = all.find((row) => row.id === input.textId);
  } else if (all.length) {
    const excluded = input.excludeTextId ? all.findIndex((row) => row.id === input.excludeTextId) : -1;
    text = excluded >= 0 && all.length > 1 ? all[(excluded + 1) % all.length] : all[0];
  }
  if (!text) return null;

  const at = now();
  const token = await new SignJWT({ tt: text.id, ps: input.preset })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(PREP_AUDIENCE)
    .setIssuedAt(Math.floor(at / 1000))
    .setExpirationTime(Math.floor((at + 10 * 60_000) / 1000))
    .sign(key());

  return {
    token,
    text: {
      id: text.id,
      title: text.title,
      words: splitTypingWords(text.body),
      wordCount: text.wordCount,
      difficulty: text.difficulty,
      topic: text.topic,
    },
  };
}

/** First valid keystroke: the server stamps the authoritative start instant. */
export async function startPreparedTypingRun(
  userId: string,
  prepToken: string,
  now: () => number = () => Date.now(),
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(prepToken, key(), {
      audience: PREP_AUDIENCE,
      subject: userId,
      currentDate: new Date(now()),
    });
    if (typeof payload.tt !== "string") return null;
    const preset = normalizePreset(payload.ps);
    if (preset === null) return null;
    const at = now();
    const lifetime = preset === 0 ? 30 * 60_000 : preset * 1000 + 60_000;
    return new SignJWT({ tt: payload.tt, ps: preset, st: at })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setAudience(RUN_AUDIENCE)
      .setJti(randomUUID())
      .setIssuedAt(Math.floor(at / 1000))
      .setExpirationTime(Math.floor((at + lifetime) / 1000))
      .sign(key());
  } catch {
    return null;
  }
}

export type VerifiedTypingResult = TypingMetrics & {
  runId: string;
  presetSeconds: TypingPreset | null;
  title: string;
};

function fullTextCompleted(target: string[], typedWords: string[]): boolean {
  if (!target.length || typedWords.length < target.length) return false;
  const committed = typedWords.slice(0, -1);
  const partial = typedWords.at(-1) ?? "";
  for (let i = 0; i < target.length - 1; i += 1) {
    if (committed[i] !== target[i]) return false;
  }
  return partial === target.at(-1);
}

/**
 * Verify the signed run and recompute every score on the server.
 * Timed runs normally finish at their preset. Because the owner supplied
 * 150–200-word passages, completing the entire canonical text is also a valid
 * early finish; duration then remains the real server-observed elapsed time.
 */
export async function finishPreparedTypingRun(
  userId: string,
  input: { runToken: string; typedWords: string[]; samples: number[] },
  deps: { database?: Database; now?: () => number } = {},
): Promise<
  | { ok: true; result: VerifiedTypingResult }
  | { ok: false; code: "invalid_token" | "not_found" | "too_early" | "bad_submission" | "conflict" }
> {
  const database = deps.database ?? db;
  const now = deps.now ?? (() => Date.now());

  let textId: string;
  let preset: TypingPreset | 0;
  let startedAt: number;
  let jti: string;
  try {
    const { payload } = await jwtVerify(input.runToken, key(), {
      audience: RUN_AUDIENCE,
      subject: userId,
      currentDate: new Date(now()),
    });
    if (typeof payload.tt !== "string" || typeof payload.st !== "number" || typeof payload.jti !== "string") {
      return { ok: false, code: "invalid_token" };
    }
    const parsedPreset = normalizePreset(payload.ps);
    if (parsedPreset === null) return { ok: false, code: "invalid_token" };
    textId = payload.tt;
    preset = parsedPreset;
    startedAt = payload.st;
    jti = payload.jti;
  } catch {
    return { ok: false, code: "invalid_token" };
  }

  const [text] = await database
    .select({ id: typingTexts.id, title: typingTexts.title, body: typingTexts.body })
    .from(typingTexts)
    .where(eq(typingTexts.id, textId))
    .limit(1);
  if (!text) return { ok: false, code: "not_found" };

  const target = splitTypingWords(text.body);
  const elapsedMs = Math.max(0, now() - startedAt);
  const complete = fullTextCompleted(target, input.typedWords);
  if (elapsedMs < 3_000) return { ok: false, code: "too_early" };
  if (preset !== 0 && !complete && elapsedMs < preset * 1000 - 1_500) {
    return { ok: false, code: "too_early" };
  }

  const seconds =
    preset === 0 || (complete && elapsedMs < preset * 1000)
      ? elapsedMs / 1000
      : preset;
  const invalid = validateTypingSubmission(target, input.typedWords, input.samples, seconds);
  if (invalid) return { ok: false, code: "bad_submission" };

  const metrics = computeWordTypingMetrics(target, input.typedWords, seconds, input.samples);
  const previous = await database
    .select({
      id: typingRuns.id,
      wpm: typingRuns.wpm,
      rawWpm: typingRuns.rawWpm,
      accuracy: typingRuns.accuracy,
      consistency: typingRuns.consistency,
      charsCorrect: typingRuns.charsCorrect,
      charsIncorrect: typingRuns.charsIncorrect,
      charsExtra: typingRuns.charsExtra,
      charsMissed: typingRuns.charsMissed,
      typedChars: typingRuns.typedChars,
      targetChars: typingRuns.targetChars,
      durationMs: typingRuns.durationMs,
    })
    .from(typingRuns)
    .where(and(eq(typingRuns.runTokenId, jti), eq(typingRuns.userId, userId)))
    .limit(1);

  if (previous[0]) {
    const row = previous[0];
    return {
      ok: true,
      result: {
        runId: row.id,
        title: text.title,
        presetSeconds: preset === 0 ? null : preset,
        wpm: Number(row.wpm),
        rawWpm: Number(row.rawWpm ?? 0),
        accuracy: Number(row.accuracy),
        consistency: row.consistency == null ? null : Number(row.consistency),
        correct: row.charsCorrect ?? 0,
        incorrect: row.charsIncorrect ?? 0,
        extra: row.charsExtra ?? 0,
        missed: row.charsMissed ?? 0,
        typedChars: row.typedChars,
        targetChars: row.targetChars,
        mistakes: (row.charsIncorrect ?? 0) + (row.charsExtra ?? 0) + (row.charsMissed ?? 0),
        completion: row.targetChars ? Math.round((Math.min(row.typedChars, row.targetChars) / row.targetChars) * 1000) / 10 : 0,
        durationMs: row.durationMs,
      },
    };
  }

  try {
    const runId = await database.transaction(async (tx) => {
      const [run] = await tx
        .insert(typingRuns)
        .values({
          userId,
          targetChars: metrics.targetChars,
          typedChars: metrics.typedChars,
          durationMs: metrics.durationMs,
          wpm: metrics.wpm.toFixed(1),
          accuracy: metrics.accuracy.toFixed(1),
          runTokenId: jti,
          rawWpm: metrics.rawWpm.toFixed(1),
          consistency: metrics.consistency == null ? null : metrics.consistency.toFixed(1),
          charsCorrect: metrics.correct,
          charsIncorrect: metrics.incorrect,
          charsExtra: metrics.extra,
          charsMissed: metrics.missed,
          startedAt: new Date(startedAt),
          finishedAt: new Date(now()),
        })
        .returning({ id: typingRuns.id });
      if (!run) throw new Error("typing_run_insert_failed");

      await tx.insert(typingRunTexts).values({
        runId: run.id,
        modelTextId: null,
        typingTextId: text.id,
        mistakes: metrics.mistakes,
        presetSeconds: preset === 0 ? null : preset,
      });
      await tx.insert(activityEvents).values({
        userId,
        type: "TYPING_RUN_COMPLETED",
        payload: {
          wpm: metrics.wpm,
          accuracy: metrics.accuracy,
          durationMs: metrics.durationMs,
          presetSeconds: preset === 0 ? null : preset,
          typingTextId: text.id,
        },
      });
      return run.id;
    });

    return {
      ok: true,
      result: {
        ...metrics,
        runId,
        presetSeconds: preset === 0 ? null : preset,
        title: text.title,
      },
    };
  } catch (error) {
    const duplicate = await database
      .select({ id: typingRuns.id })
      .from(typingRuns)
      .where(and(eq(typingRuns.runTokenId, jti), eq(typingRuns.userId, userId)))
      .limit(1);
    if (duplicate[0]) {
      return finishPreparedTypingRun(userId, input, deps);
    }
    console.error("[writing-typing] failed to persist verified run", error);
    return { ok: false, code: "conflict" };
  }
}

/* -------------------------------------------------------------------------
 * Legacy model-answer typing is kept for history compatibility and any old
 * browser tab still holding the previous client bundle.
 * ---------------------------------------------------------------------- */

export type ModelTextView = {
  id: string;
  title: string;
  taskType: "task1" | "task2";
  topic: string;
  targetBand: number;
  body: string;
  wordCount: number;
};

export async function listWritingModelTexts(database: Database = db): Promise<ModelTextView[]> {
  const rows = await database
    .select({
      id: writingModelTexts.id,
      title: writingModelTexts.title,
      taskType: writingModelTexts.taskType,
      topic: writingModelTexts.topic,
      targetBand: writingModelTexts.targetBand,
      body: writingModelTexts.body,
      wordCount: writingModelTexts.wordCount,
    })
    .from(writingModelTexts)
    .where(legacyLive())
    .orderBy(asc(writingModelTexts.taskType), asc(writingModelTexts.topic), asc(writingModelTexts.title));
  return rows.map((row) => ({ ...row, targetBand: Number(row.targetBand) }));
}

async function legacyText(database: Database, id: string) {
  const [row] = await database
    .select({ id: writingModelTexts.id, body: writingModelTexts.body })
    .from(writingModelTexts)
    .where(and(eq(writingModelTexts.id, id), legacyLive()))
    .limit(1);
  return row ?? null;
}

export async function issueTypingToken(
  userId: string,
  modelTextId: string,
  database: Database = db,
  presetSeconds: TypingPreset | null = null,
  now: () => number = () => Date.now(),
) {
  if (presetSeconds !== null && !isTypingPreset(presetSeconds)) return null;
  if (!(await legacyText(database, modelTextId))) return null;
  const iat = Math.floor(now() / 1000);
  const exp = presetSeconds === null ? iat + 2 * 60 * 60 : iat + presetSeconds + Math.ceil(TIMED_SUBMIT_GRACE_MS / 1000);
  return new SignJWT({ mt: modelTextId, ps: presetSeconds })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(LEGACY_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key());
}

export type RecordResult =
  | { ok: true; result: TypingResult; runId: string; presetSeconds: TypingPreset | null }
  | { ok: false; code: "not_found" | "invalid_token" | "expired" | "invalid_duration" | "too_long" };

export async function recordModelTextRun(
  userId: string,
  input: { modelTextId: string; typedText: string; durationMs: number; token: string },
  deps: { database?: Database; now?: () => number } = {},
): Promise<RecordResult> {
  const database = deps.database ?? db;
  const now = deps.now ?? (() => Date.now());
  let issuedAtMs: number;
  let presetSeconds: TypingPreset | null;
  try {
    const { payload } = await jwtVerify(input.token, key(), {
      audience: LEGACY_AUDIENCE,
      subject: userId,
      currentDate: new Date(now()),
    });
    if (payload.mt !== input.modelTextId || typeof payload.iat !== "number") {
      return { ok: false, code: "invalid_token" };
    }
    const ps = payload.ps ?? null;
    if (ps !== null && !isTypingPreset(ps)) return { ok: false, code: "invalid_token" };
    issuedAtMs = payload.iat * 1000;
    presetSeconds = ps;
  } catch (error) {
    return {
      ok: false,
      code: (error as { code?: string })?.code === "ERR_JWT_EXPIRED" ? "expired" : "invalid_token",
    };
  }
  const text = await legacyText(database, input.modelTextId);
  if (!text) return { ok: false, code: "not_found" };
  if (input.typedText.length > text.body.length + 200) return { ok: false, code: "too_long" };

  const serverElapsed = now() - issuedAtMs;
  const client = input.durationMs;
  let durationMs =
    client <= serverElapsed + 1_000 && client >= serverElapsed - CLIENT_SLACK_MS
      ? client
      : serverElapsed;
  if (presetSeconds !== null) durationMs = Math.min(durationMs, presetSeconds * 1000);

  let result: TypingResult;
  try {
    result = computeTypingResult(text.body, input.typedText, Math.round(durationMs));
  } catch {
    return { ok: false, code: "invalid_duration" };
  }

  const runId = await database.transaction(async (tx) => {
    const [run] = await tx
      .insert(typingRuns)
      .values({
        userId,
        targetChars: result.targetChars,
        typedChars: result.typedChars,
        durationMs: result.durationMs,
        wpm: result.wpm.toFixed(1),
        accuracy: result.accuracy.toFixed(1),
      })
      .returning({ id: typingRuns.id });
    await tx.insert(typingRunTexts).values({
      runId: run!.id,
      modelTextId: input.modelTextId,
      typingTextId: null,
      mistakes: result.mistakes,
      presetSeconds,
    });
    await tx.insert(activityEvents).values({
      userId,
      type: "TYPING_RUN_COMPLETED",
      payload: {
        wpm: result.wpm,
        accuracy: result.accuracy,
        durationMs: result.durationMs,
        presetSeconds,
      },
    });
    return run!.id;
  });
  return { ok: true, result, runId, presetSeconds };
}

export async function typingStats(userId: string, database: Database = db) {
  const [summary] = await database
    .select({
      count: count(),
      bestWpm: max(typingRuns.wpm),
      bestAccuracy: max(typingRuns.accuracy),
    })
    .from(typingRuns)
    .where(eq(typingRuns.userId, userId));

  const total = Number(summary?.count ?? 0);
  const history = await database
    .select({
      id: typingRuns.id,
      createdAt: typingRuns.createdAt,
      wpm: typingRuns.wpm,
      accuracy: typingRuns.accuracy,
      durationMs: typingRuns.durationMs,
      mistakes: typingRunTexts.mistakes,
      presetSeconds: typingRunTexts.presetSeconds,
      title: sql<string>`coalesce(${typingTexts.title}, ${writingModelTexts.title}, 'Typing')`,
    })
    .from(typingRuns)
    .innerJoin(typingRunTexts, eq(typingRunTexts.runId, typingRuns.id))
    .leftJoin(typingTexts, eq(typingTexts.id, typingRunTexts.typingTextId))
    .leftJoin(writingModelTexts, eq(writingModelTexts.id, typingRunTexts.modelTextId))
    .where(eq(typingRuns.userId, userId))
    .orderBy(desc(typingRuns.createdAt))
    .limit(10);

  return {
    count: total,
    bestWpm: total && summary?.bestWpm != null ? Number(summary.bestWpm) : null,
    bestAccuracy: total && summary?.bestAccuracy != null ? Number(summary.bestAccuracy) : null,
    history: history.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      wpm: Number(row.wpm),
      accuracy: Number(row.accuracy),
    })),
  };
}
