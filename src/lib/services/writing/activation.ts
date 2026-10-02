import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, lexemes, userVocabulary } from "@/db/schema";
import { runWritingCheck, type CheckOutcome, type CheckResult } from "@/lib/services/writing/check";
import { confirmSentenceUse, recordSentenceUse } from "@/lib/services/vocabulary/engine";
import type { WritingCheckInput } from "@/lib/services/coach/types";
import { cleanCustomItem, containsItem, type ActivationLevel, type ActivationMode } from "@/lib/writing/activation-rules";

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

export async function randomActivationItems(userId: string, count: number, database: Database = db): Promise<ActivationItem[]> {
  const rows = await database.select({ entryId: userVocabulary.id, term: lexemes.term, definitionEn: lexemes.definitionEn, translationUz: lexemes.translationUz })
    .from(userVocabulary).innerJoin(lexemes, eq(lexemes.id, userVocabulary.lexemeId))
    .where(eq(userVocabulary.userId, userId))
    .orderBy(sql`random()`).limit(Math.min(30, Math.max(1, count)));
  return rows;
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
  | { ok: true; verdict: CheckResult["verdict"]; result: CheckResult | null; itemMissing: boolean; usageRecorded: boolean; stats: SessionStats }
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
    const outcome = await check(userId, language, {
      kind: "activation", item: item.term, meaningHint: item.definitionEn, mode: input.mode, targetLevel: input.targetLevel,
      uzbekPrompt: input.uzbekPrompt ? item.translationUz : null, upgradeFrom: input.upgradeFrom?.trim() || null, answer,
    });
    if (!outcome.ok) return { ok: false, code: outcome.reason };
    result = outcome.result;
    verdict = result.verdict;
  }

  let usageRecorded = false;
  if (item.entryId && result && verdict !== "needs_revision") {
    const stored = await recordSentenceUse({ userId, entryId: item.entryId, sentence: answer }, database);
    if (stored.ok) {
      const confirmed = await confirmSentenceUse({ userId, usageId: stored.usageId, accepted: true, evaluationId: result.evaluationId ?? crypto.randomUUID(), origin: "external_ai" }, database);
      usageRecorded = confirmed.ok;
    }
  }

  await database.insert(activityEvents).values({ userId, type: ACTIVATION_EVENT, payload: {
    sessionId: input.sessionId, term: item.term, entryId: item.entryId, mode: input.mode, targetLevel: input.targetLevel,
    verdict, itemMissing, bands: result?.bands ?? null, usageRecorded,
  } });
  return { ok: true, verdict, result, itemMissing, usageRecorded, stats: await activationSessionStats(userId, input.sessionId, database) };
}

export type SessionStats = { attempts: number; accepted: number; needsRevision: number; items: number; usageRecorded: number; averageBands: Record<string, number> };

export async function activationSessionStats(userId: string, sessionId: string, database: Database = db): Promise<SessionStats> {
  const rows = await database.select({ payload: activityEvents.payload }).from(activityEvents)
    .where(and(eq(activityEvents.userId, userId), eq(activityEvents.type, ACTIVATION_EVENT), sql`${activityEvents.payload}->>'sessionId' = ${sessionId}`))
    .orderBy(desc(activityEvents.createdAt)).limit(500);
  const ps = rows.map((r) => r.payload as { term: string; verdict: string; bands: Record<string, number | null> | null; usageRecorded: boolean });
  const sums: Record<string, { s: number; n: number }> = {};
  for (const p of ps) for (const [k, v] of Object.entries(p.bands ?? {})) if (typeof v === "number") { sums[k] ??= { s: 0, n: 0 }; sums[k].s += v; sums[k].n += 1; }
  return {
    attempts: ps.length,
    accepted: ps.filter((p) => p.verdict === "correct" || p.verdict === "acceptable").length,
    needsRevision: ps.filter((p) => p.verdict === "needs_revision").length,
    items: new Set(ps.map((p) => p.term.toLowerCase())).size,
    usageRecorded: ps.filter((p) => p.usageRecorded).length,
    averageBands: Object.fromEntries(Object.entries(sums).map(([k, { s, n }]) => [k, Math.round((s / n) * 2) / 2])),
  };
}

export async function activationVocabularyCount(userId: string, database: Database = db): Promise<number> {
  const [row] = await database.select({ n: sql<number>`count(*)::int` }).from(userVocabulary).where(eq(userVocabulary.userId, userId));
  return Number(row?.n ?? 0);
}
