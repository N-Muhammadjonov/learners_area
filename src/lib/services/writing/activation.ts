import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, lexemes, userVocabulary } from "@/db/schema";
import { runWritingCheck, type CheckOutcome, type CheckResult } from "@/lib/services/writing/check";
import { confirmSentenceUse, recordSentenceUse } from "@/lib/services/vocabulary/engine";
import type { WritingCheckInput } from "@/lib/services/coach/types";
import { activationMatchKey, activationScore, cleanCustomItem, containsItem, type ActivationLevel, type ActivationMode } from "@/lib/writing/activation-rules";
import { dayKey, streakFromDays } from "@/lib/services/vocabulary/points";

type Database = typeof db;
type Check = (userId: string, language: "uz" | "en", check: WritingCheckInput) => Promise<CheckOutcome>;
export const ACTIVATION_EVENT = "WRITING_ACTIVATION_CHECK";

/**
 * Activation Lab (§44 / PDF p.18). Random items come from the learner's real
 * Vocabulary; own-list items are accepted as plain text without inventing a
 * canonical sense. External AI judges each sentence; an accepted sentence for
 * a saved word becomes real usage evidence through the one vocabulary engine
 * (mastery moves only by the engine's existing policy). Every check is logged
 * so the session statistics are computed from stored rows, never invented.
 */

export type ActivationItem = { entryId: string | null; term: string; definitionEn: string | null; translationUz: string | null };

const itemColumns = { entryId: userVocabulary.id, term: lexemes.term, definitionEn: lexemes.definitionEn, translationUz: lexemes.translationUz };

/**
 * Random items from the learner's real Vocabulary, by priority tier, random
 * within a tier: 0 = never actively used, 1 = due for review, 2 = saved in the
 * last 14 days, 3 = everything else. Reads existing SRS fields only.
 */
export async function randomActivationItems(userId: string, count: number, database: Database = db): Promise<ActivationItem[]> {
  const tier = sql`case when ${userVocabulary.activeUseCount} = 0 then 0 when ${userVocabulary.nextReviewAt} <= now() then 1 when ${userVocabulary.createdAt} > now() - interval '14 days' then 2 else 3 end`;
  return database.select(itemColumns)
    .from(userVocabulary).innerJoin(lexemes, eq(lexemes.id, userVocabulary.lexemeId))
    .where(eq(userVocabulary.userId, userId))
    .orderBy(tier, sql`random()`).limit(Math.min(30, Math.max(1, count)));
}

/**
 * Own-list resolution (server-side, this learner's Vocabulary only): a term
 * that matches a saved item becomes that canonical entry; an unknown valid
 * term stays a custom practice item with no invented sense/translation.
 */
export async function resolveActivationItems(userId: string, terms: string[], database: Database = db): Promise<ActivationItem[]> {
  const cleaned = [...new Set(terms.map((t) => cleanCustomItem(t)).filter((t): t is string => Boolean(t)))].slice(0, 30);
  if (!cleaned.length) return [];
  const keys = cleaned.map(activationMatchKey);
  const rows = await database.select(itemColumns)
    .from(userVocabulary).innerJoin(lexemes, eq(lexemes.id, userVocabulary.lexemeId))
    .where(eq(userVocabulary.userId, userId))
    // Whole own library: a saved word older than any row cap must still resolve to its entry.
    .orderBy(desc(userVocabulary.createdAt));
  const byKey = new Map<string, ActivationItem>();
  for (const r of rows) if (!byKey.has(activationMatchKey(r.term))) byKey.set(activationMatchKey(r.term), r);
  return cleaned.map((term, i) => byKey.get(keys[i]!) ?? { entryId: null, term, definitionEn: null, translationUz: null });
}

export type ActivationInput = {
  sessionId: string;
  entryId?: string | null;
  customTerm?: string | null;
  mode: ActivationMode;
  targetLevel: ActivationLevel;
  uzbekPrompt: boolean;
  upgradeFrom?: string | null;
  answer: string;
};

export type ActivationOutcome =
  | { ok: true; verdict: CheckResult["verdict"]; result: CheckResult | null; itemMissing: boolean; usageRecorded: boolean; activationScore: number | null; uzbekApplied: boolean; stats: SessionStats }
  | { ok: false; code: "not_found" | "invalid_item" | "empty" | "unavailable" | "failed" };

export async function checkActivation(userId: string, language: "uz" | "en", input: ActivationInput, deps: { database?: Database; check?: Check } = {}): Promise<ActivationOutcome> {
  const database = deps.database ?? db;
  const answer = input.answer.trim();
  if (!answer) return { ok: false, code: "empty" };
  let item: ActivationItem;
  if (input.entryId) {
    const [row] = await database.select({ entryId: userVocabulary.id, term: lexemes.term, definitionEn: lexemes.definitionEn, translationUz: lexemes.translationUz })
      .from(userVocabulary).innerJoin(lexemes, eq(lexemes.id, userVocabulary.lexemeId))
      .where(and(eq(userVocabulary.id, input.entryId), eq(userVocabulary.userId, userId)));
    if (!row) return { ok: false, code: "not_found" };
    item = row;
  } else {
    const term = cleanCustomItem(input.customTerm ?? "");
    if (!term) return { ok: false, code: "invalid_item" };
    item = { entryId: null, term, definitionEn: null, translationUz: null };
  }

  let result: CheckResult | null = null;
  let verdict: CheckResult["verdict"];
  const itemMissing = !containsItem(answer, item.term);
  if (itemMissing) {
    verdict = "needs_revision"; // Not used at all: no AI call, no evidence.
  } else {
    const check = deps.check ?? ((u, l, c) => runWritingCheck(u, l, c));
    const outcome = await check(userId, language, {  // Uzbek cue only when a trusted canonical translation exists.
      kind: "activation", item: item.term, meaningHint: item.definitionEn, mode: input.mode, targetLevel: input.targetLevel,
      uzbekPrompt: input.uzbekPrompt ? item.translationUz : null, upgradeFrom: input.upgradeFrom?.trim() || null, answer,
    });
    if (!outcome.ok) return { ok: false, code: outcome.reason };
    result = outcome.result;
    verdict = result.verdict;
  }

  const uzbekApplied = input.uzbekPrompt && Boolean(item.translationUz);
  const score = activationScore(result?.bands);
  let usageRecorded = false;

  // One learner action, one unit of work: the sentence use it records, and the event that is the only
  // evidence the attempt ever happened. `statsFromEvents` counts these rows directly — `attempts` is
  // the row count, `wordsActivated` the rows claiming `usageRecorded` — so writing the event outside
  // the transaction meant a failed insert left a confirmed `vocabulary_usages` row with no record of
  // the activation, and the payload's own `usageRecorded` claim could not be trusted either way.
  // The AI check stays OUTSIDE the transaction: holding one open across an external call is a defect
  // of its own, and by here the verdict is already decided.
  await database.transaction(async (tx) => {
    if (item.entryId && result && verdict !== "needs_revision") {
      const stored = await recordSentenceUse({ userId, entryId: item.entryId, sentence: answer }, tx);
      if (stored.ok) {
        const confirmed = await confirmSentenceUse({ userId, usageId: stored.usageId, accepted: true, evaluationId: result.evaluationId ?? crypto.randomUUID(), origin: "external_ai" }, tx);
        usageRecorded = confirmed.ok;
      }
    }

    await tx.insert(activityEvents).values({ userId, type: ACTIVATION_EVENT, payload: {
      sessionId: input.sessionId, term: item.term, entryId: item.entryId, mode: input.mode, targetLevel: input.targetLevel,
      verdict, itemMissing, bands: result?.bands ?? null, usageRecorded, activationScore: score, uzbekApplied,
      answer, feedback: result?.feedback ?? null, improved: result?.improved ?? null, fixes: result?.fixes.slice(0, 3) ?? [],
    } });
  });
  return { ok: true, verdict, result, itemMissing, usageRecorded, activationScore: score, uzbekApplied, stats: await activationSessionStats(userId, input.sessionId, database) };
}

type EventPayload = { sessionId: string; term: string; entryId: string | null; verdict: string; bands: Record<string, number | null> | null; usageRecorded: boolean; activationScore?: number | null };
export type SessionStats = { attempts: number; accepted: number; needsRevision: number; items: number; usageRecorded: number; averageBands: Record<string, number>; averageActivation: number | null };

/** Stats from stored check events only: one row per real POST /check, so re-renders or opening the summary cannot inflate them. */
export function statsFromEvents(ps: EventPayload[]): SessionStats {
  const sums: Record<string, { s: number; n: number }> = {};
  for (const p of ps) for (const [k, v] of Object.entries(p.bands ?? {})) if (typeof v === "number") { sums[k] ??= { s: 0, n: 0 }; sums[k].s += v; sums[k].n += 1; }
  const scores = ps.map((p) => p.activationScore).filter((v): v is number => typeof v === "number");
  return {
    attempts: ps.length,
    accepted: ps.filter((p) => p.verdict === "correct" || p.verdict === "acceptable").length,
    needsRevision: ps.filter((p) => p.verdict === "needs_revision").length,
    items: new Set(ps.map((p) => p.term.toLowerCase())).size,
    usageRecorded: ps.filter((p) => p.usageRecorded).length,
    averageBands: Object.fromEntries(Object.entries(sums).map(([k, { s, n }]) => [k, Math.round((s / n) * 2) / 2])),
    averageActivation: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
  };
}

export async function activationSessionStats(userId: string, sessionId: string, database: Database = db): Promise<SessionStats> {
  const rows = await database.select({ payload: activityEvents.payload }).from(activityEvents)
    .where(and(eq(activityEvents.userId, userId), eq(activityEvents.type, ACTIVATION_EVENT), sql`${activityEvents.payload}->>'sessionId' = ${sessionId}`))
    .orderBy(desc(activityEvents.createdAt)).limit(500);
  return statsFromEvents(rows.map((r) => r.payload as EventPayload));
}

export type ActivationOverview = {
  wordsActivated: number;
  averageActivation: number | null;
  dayStreak: number;
  lastSession: { at: string; stats: SessionStats } | null;
};

/** Right-rail statistics, all from stored WRITING_ACTIVATION_CHECK events (null/0 when there is no history — never invented). */
export async function activationOverview(userId: string, database: Database = db, now = new Date()): Promise<ActivationOverview> {
  const rows = await database.select({ payload: activityEvents.payload, createdAt: activityEvents.createdAt }).from(activityEvents)
    .where(and(eq(activityEvents.userId, userId), eq(activityEvents.type, ACTIVATION_EVENT)))
    .orderBy(desc(activityEvents.createdAt)).limit(2000);
  const ps = rows.map((r) => ({ ...(r.payload as EventPayload), at: r.createdAt }));
  const activated = new Set(ps.filter((p) => p.usageRecorded && p.entryId).map((p) => p.entryId));
  const all = statsFromEvents(ps);
  const last = ps[0];
  return {
    wordsActivated: activated.size,
    averageActivation: all.averageActivation,
    dayStreak: ps.length ? streakFromDays(ps.map((p) => dayKey(p.at)), now) : 0,
    lastSession: last ? { at: last.at.toISOString(), stats: statsFromEvents(ps.filter((p) => p.sessionId === last.sessionId)) } : null,
  };
}

export async function activationVocabularyCount(userId: string, database: Database = db): Promise<number> {
  const [row] = await database.select({ n: sql<number>`count(*)::int` }).from(userVocabulary).where(eq(userVocabulary.userId, userId));
  return Number(row?.n ?? 0);
}
