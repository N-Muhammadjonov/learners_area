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
import { BUNDLED_TYPING_TEXTS, bundledTypingTextById } from "@/lib/services/writing/typing-corpus";
import {
  activeElapsedMs,
  countTyped,
  PAUSE_LIMITS,
  sanitizeSamples,
  validateSubmission,
} from "@/lib/services/writing/typing-metrics";
import {
  computeTypingResult,
  computeWordTypingMetrics,
  isTypingPreset,
  splitTypingWords,
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

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Write a typing run naming ONLY the columns migration 0008 created.
 *
 * This is not a style preference. drizzle lists every column of a table in an INSERT — the
 * nullable trainer columns 0048 adds are emitted as `default` even when the caller did not
 * set them — so a database that has not applied 0048 rejects the whole statement with
 * "column ... does not exist". The trainer's extra numbers already travel in the
 * `TYPING_RUN_COMPLETED` activity payload and stay server-derived from the signed text, so
 * naming the legacy columns keeps a verified run saveable BOTH before and after 0048. That
 * is the same "one migration behind" tolerance the bundled corpus fallback exists for; the
 * claim was in the comments but not in the SQL, which is what test TY1b caught.
 */
async function insertTypingRunLegacy(
  tx: Tx,
  values: { userId: string; targetChars: number; typedChars: number; durationMs: number; wpm: string; accuracy: string },
): Promise<string> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    insert into "typing_runs" ("user_id", "target_chars", "typed_chars", "duration_ms", "wpm", "accuracy")
    values (${values.userId}, ${values.targetChars}, ${values.typedChars}, ${values.durationMs}, ${values.wpm}, ${values.accuracy})
    returning "id"
  `);
  const id = rows[0]?.id;
  if (!id) throw new Error("typing_run_insert_failed");
  return id;
}

/**
 * The same rule for the legacy model-text link row: `typing_text_id` arrives with 0048 and
 * is left to its nullable default, so the statement stays valid on a database that has not
 * applied it yet.
 */
async function insertTypingRunTextLegacy(
  tx: Tx,
  values: { runId: string; modelTextId: string; mistakes: number; presetSeconds: number | null },
): Promise<void> {
  await tx.execute(sql`
    insert into "typing_run_texts" ("run_id", "model_text_id", "mistakes", "preset_seconds")
    values (${values.runId}, ${values.modelTextId}, ${values.mistakes}, ${values.presetSeconds})
  `);
}

export type TypingTextView = {
  id: string;
  externalId: string;
  title: string;
  body: string;
  wordCount: number;
  difficulty: string | null;
  topic: string | null;
};

function isTypingSchemaUnavailable(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string }; message?: string };
  const code = value?.cause?.code ?? value?.code;
  return code === "42P01" || code === "42703" ||
    /typing_texts|typing_text_id|run_token_id|raw_wpm|chars_correct/i.test(value?.message ?? "");
}

export async function listTypingTexts(database: Database = db): Promise<TypingTextView[]> {
  try {
    return await database
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
  } catch (error) {
    if (!isTypingSchemaUnavailable(error)) throw error;
    // Preview can legitimately be one additive migration behind. Use the exact
    // owner-supplied corpus until 0048 is approved/applied instead of replacing
    // the requested trainer with an error panel.
    return BUNDLED_TYPING_TEXTS.map((row) => ({ ...row }));
  }
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
    const candidates =
      input.excludeTextId && all.length > 1
        ? all.filter((row) => row.id !== input.excludeTextId)
        : all;
    text = candidates[Math.floor(Math.random() * candidates.length)] ?? all[0];
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
    const lifetime = preset === 0 ? 24 * 60 * 60_000 : preset * 1000 + 60_000;
    return new SignJWT({ tt: payload.tt, ps: preset, st: at, pm: 0, pc: 0 })
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

export async function togglePreparedTypingPause(
  userId: string,
  runToken: string,
  action: "pause" | "resume",
  now: () => number = () => Date.now(),
): Promise<{ runToken: string; paused: boolean; pausedMs: number } | null> {
  try {
    const at = now();
    const { payload } = await jwtVerify(runToken, key(), {
      audience: RUN_AUDIENCE,
      subject: userId,
      currentDate: new Date(at),
    });
    if (
      typeof payload.tt !== "string" ||
      typeof payload.st !== "number" ||
      typeof payload.jti !== "string" ||
      normalizePreset(payload.ps) !== 0
    ) {
      return null;
    }

    const pausedMs = typeof payload.pm === "number" && payload.pm >= 0 ? payload.pm : 0;
    const pausedAt = typeof payload.pa === "number" && payload.pa >= payload.st ? payload.pa : null;
    const pauses = typeof payload.pc === "number" && payload.pc >= 0 ? payload.pc : 0;

    if (action === "pause") {
      if (pausedAt !== null) return { runToken, paused: true, pausedMs };
      if (pauses >= PAUSE_LIMITS.count) return null;
      const nextToken = await new SignJWT({
        tt: payload.tt, ps: 0, st: payload.st, pm: pausedMs, pa: at, pc: pauses + 1,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setAudience(RUN_AUDIENCE)
        .setJti(payload.jti)
        .setIssuedAt(Math.floor(at / 1000))
        .setExpirationTime(Math.floor((at + 24 * 60 * 60_000) / 1000))
        .sign(key());
      return { runToken: nextToken, paused: true, pausedMs };
    }

    if (pausedAt === null) return { runToken, paused: false, pausedMs };

    const remainingPauseBudget = Math.max(0, PAUSE_LIMITS.total - pausedMs);
    const thisPause = Math.min(
      Math.max(0, at - pausedAt),
      PAUSE_LIMITS.single,
      remainingPauseBudget,
    );
    const nextPausedMs = pausedMs + thisPause;
    const nextToken = await new SignJWT({
      tt: payload.tt, ps: 0, st: payload.st, pm: nextPausedMs, pc: pauses,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setAudience(RUN_AUDIENCE)
      .setJti(payload.jti)
      .setIssuedAt(Math.floor(at / 1000))
      .setExpirationTime(Math.floor((at + 24 * 60 * 60_000) / 1000))
      .sign(key());

    return { runToken: nextToken, paused: false, pausedMs: nextPausedMs };
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
  if (!target.length) return false;
  const committed = typedWords.slice(0, -1);
  const partial = typedWords.at(-1) ?? "";
  // Completion is about reaching the end of the canonical passage, not scoring
  // perfectly. Earlier wrong words remain mistakes and are scored as such.
  return committed.length >= target.length ||
    (committed.length === target.length - 1 && partial === target.at(-1));
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
  | { ok: false; code: "invalid_token" | "not_found" | "too_early" | "paused" | "bad_submission" | "conflict" }
> {
  const database = deps.database ?? db;
  const now = deps.now ?? (() => Date.now());

  let textId: string;
  let preset: TypingPreset | 0;
  let startedAt: number;
  let pausedMs = 0;
  let pausedAt: number | null = null;
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
    pausedMs = typeof payload.pm === "number" && payload.pm >= 0 ? payload.pm : 0;
    pausedAt = typeof payload.pa === "number" && payload.pa >= startedAt ? payload.pa : null;
    if (preset !== 0 && (pausedMs !== 0 || pausedAt !== null)) {
      return { ok: false, code: "invalid_token" };
    }
    if (pausedAt !== null) {
      return { ok: false, code: "paused" };
    }
    jti = payload.jti;
  } catch {
    return { ok: false, code: "invalid_token" };
  }

  let text: { id: string; title: string; body: string } | null = null;
  try {
    const [row] = await database
      .select({ id: typingTexts.id, title: typingTexts.title, body: typingTexts.body })
      .from(typingTexts)
      .where(eq(typingTexts.id, textId))
      .limit(1);
    text = row ?? null;
  } catch (error) {
    if (!isTypingSchemaUnavailable(error)) throw error;
    text = bundledTypingTextById(textId);
  }
  if (!text) return { ok: false, code: "not_found" };

  const target = splitTypingWords(text.body);
  const elapsedMs = activeElapsedMs(startedAt, now(), pausedMs, null);
  const complete = fullTextCompleted(target, input.typedWords);

  let seconds: number;
  if (preset === 0) {
    if (elapsedMs < 3_000) return { ok: false, code: "too_early" };
    seconds = elapsedMs / 1000;
  } else {
    // Uploaded ready-code rule: serverless /start can finish after the client
    // has already begun typing. A loose 60% floor proves this was not an
    // instant forged submit, while every timed run is still scored over the
    // FULL selected preset, so the tolerance can only lower—not inflate—WPM.
    if (!complete && elapsedMs < preset * 1000 * 0.6) {
      return { ok: false, code: "too_early" };
    }
    seconds = preset;
  }

  const invalid = validateSubmission(target, input.typedWords, seconds);
  if (invalid) return { ok: false, code: "bad_submission" };

  // Uploaded ready code treats graph/consistency samples as optional telemetry:
  // repair them when possible and never reject an otherwise valid scored run.
  const verifiedSamples = sanitizeSamples(
    input.samples,
    countTyped(input.typedWords),
    seconds,
  );
  const metrics = computeWordTypingMetrics(target, input.typedWords, seconds, verifiedSamples);

  // Persist every new trainer run through the original typing_runs +
  // activity_events contract. Those columns exist both before and after
  // migration 0048, so a Preview database one migration behind cannot reject
  // an otherwise valid result. Extra trainer metrics live in the event payload
  // and remain server-derived from the signed canonical text.
  try {
    const recentEvents = await database
      .select({ payload: activityEvents.payload })
      .from(activityEvents)
      .where(and(
        eq(activityEvents.userId, userId),
        eq(activityEvents.type, "TYPING_RUN_COMPLETED"),
      ))
      .orderBy(desc(activityEvents.createdAt))
      .limit(50);

    const existing = recentEvents
      .map((row) => row.payload as Record<string, unknown> | null)
      .find((payload) => payload?.runTokenId === jti);

    if (existing && typeof existing.runId === "string") {
      return {
        ok: true,
        result: {
          ...metrics,
          runId: existing.runId,
          title: typeof existing.title === "string" ? existing.title : text.title,
          presetSeconds: preset === 0 ? null : preset,
        },
      };
    }

    const runId = await database.transaction(async (tx) => {
      const runId = await insertTypingRunLegacy(tx, {
        userId,
        targetChars: metrics.targetChars,
        typedChars: metrics.typedChars,
        durationMs: metrics.durationMs,
        wpm: metrics.wpm.toFixed(1),
        accuracy: metrics.accuracy.toFixed(1),
      });

      await tx.insert(activityEvents).values({
        userId,
        type: "TYPING_RUN_COMPLETED",
        payload: {
          runId,
          runTokenId: jti,
          title: text.title,
          wpm: metrics.wpm,
          rawWpm: metrics.rawWpm,
          accuracy: metrics.accuracy,
          consistency: metrics.consistency,
          correct: metrics.correct,
          incorrect: metrics.incorrect,
          extra: metrics.extra,
          missed: metrics.missed,
          mistakes: metrics.mistakes,
          completion: metrics.completion,
          targetChars: metrics.targetChars,
          typedChars: metrics.typedChars,
          durationMs: metrics.durationMs,
          presetSeconds: preset === 0 ? null : preset,
          typingTextId: text.id,
          startedAt,
          pausedMs,
          finishedAt: now(),
        },
      });

      return runId;
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
    const insertedId = await insertTypingRunLegacy(tx, {
      userId,
      targetChars: result.targetChars,
      typedChars: result.typedChars,
      durationMs: result.durationMs,
      wpm: result.wpm.toFixed(1),
      accuracy: result.accuracy.toFixed(1),
    });
    // `typing_text_id` is omitted on purpose: legacy Preview databases do not have the
    // 0048 column yet, while migrated databases accept the nullable default.
    await insertTypingRunTextLegacy(tx, {
      runId: insertedId,
      modelTextId: input.modelTextId,
      mistakes: result.mistakes,
      presetSeconds,
    });
    await tx.insert(activityEvents).values({
      userId,
      type: "TYPING_RUN_COMPLETED",
      payload: {
        runId: insertedId,
        wpm: result.wpm,
        accuracy: result.accuracy,
        durationMs: result.durationMs,
        presetSeconds,
      },
    });
    return insertedId;
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

  const [runs, events, legacyLinks] = await Promise.all([
    database
      .select({
        id: typingRuns.id,
        createdAt: typingRuns.createdAt,
        wpm: typingRuns.wpm,
        accuracy: typingRuns.accuracy,
        durationMs: typingRuns.durationMs,
      })
      .from(typingRuns)
      .where(eq(typingRuns.userId, userId))
      .orderBy(desc(typingRuns.createdAt))
      .limit(10),
    database
      .select({ payload: activityEvents.payload })
      .from(activityEvents)
      .where(and(
        eq(activityEvents.userId, userId),
        eq(activityEvents.type, "TYPING_RUN_COMPLETED"),
      ))
      .orderBy(desc(activityEvents.createdAt))
      .limit(50),
    database
      .select({
        runId: typingRunTexts.runId,
        mistakes: typingRunTexts.mistakes,
        presetSeconds: typingRunTexts.presetSeconds,
        title: writingModelTexts.title,
      })
      .from(typingRunTexts)
      .innerJoin(typingRuns, eq(typingRuns.id, typingRunTexts.runId))
      .leftJoin(writingModelTexts, eq(writingModelTexts.id, typingRunTexts.modelTextId))
      .where(eq(typingRuns.userId, userId)),
  ]);

  const eventByRun = new Map<string, Record<string, unknown>>();
  for (const row of events) {
    const payload = row.payload as Record<string, unknown> | null;
    if (payload && typeof payload.runId === "string") eventByRun.set(payload.runId, payload);
  }
  const legacyByRun = new Map(legacyLinks.map((row) => [row.runId, row] as const));
  const total = Number(summary?.count ?? 0);

  return {
    count: total,
    bestWpm: total && summary?.bestWpm != null ? Number(summary.bestWpm) : null,
    bestAccuracy: total && summary?.bestAccuracy != null ? Number(summary.bestAccuracy) : null,
    history: runs.map((row) => {
      const payload = eventByRun.get(row.id);
      const legacy = legacyByRun.get(row.id);
      return {
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
        wpm: Number(row.wpm),
        accuracy: Number(row.accuracy),
        mistakes: typeof payload?.mistakes === "number"
          ? payload.mistakes
          : legacy?.mistakes ?? 0,
        presetSeconds: typeof payload?.presetSeconds === "number"
          ? payload.presetSeconds
          : legacy?.presetSeconds ?? null,
        title: typeof payload?.title === "string"
          ? payload.title
          : legacy?.title ?? "Typing",
      };
    }),
  };
}
