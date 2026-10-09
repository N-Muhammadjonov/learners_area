import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, writingLanguagePatterns, writingModelTexts, writingPatternBank, writingStealingSessions } from "@/db/schema";
import { liveWhere } from "@/lib/services/cms/publication";
import { runWritingCheck, type CheckOutcome, type CheckResult } from "@/lib/services/writing/check";
import type { WritingCheckInput } from "@/lib/services/coach/types";
import type { PatternFunction } from "@/lib/writing/pattern-functions";
import { activationMatchKey, activationTokens } from "@/lib/writing/activation-rules";
import {
  FALLBACK_TOPICS, MIN_ADAPTATION_BAND, MIN_BRAINSTORM_WORDS, MIN_COMPARE_WORDS, MIN_DRAFT_WORDS, REWRITE_DELAY_DAYS,
  nearCopy, patternsUsed, wordCount, type CopyCheck,
} from "@/lib/writing/stealing-rules";

type Database = typeof db;
type Check = (userId: string, language: "uz" | "en", check: WritingCheckInput) => Promise<CheckOutcome>;
export const PATTERN_PRACTICE_EVENT = "WRITING_PATTERN_PRACTICE";

/**
 * Language Stealing (§44). Library = published writing_language_patterns
 * (short patterns + ONE authorized example; provenance stays server-side).
 * Practice = adapt a pattern to a NEW topic: a deterministic near-copy guard
 * runs first, then the external AI pattern check (Coach resolver, fallback
 * none). The 7-step workflow is persisted in writing_stealing_sessions.
 */

const livePattern = () => liveWhere({ publicationState: writingLanguagePatterns.publicationState, publishAt: writingLanguagePatterns.publishAt });
const liveText = () => liveWhere({ publicationState: writingModelTexts.publicationState, publishAt: writingModelTexts.publishAt });

/** One bounded page of the pattern library. */
const STEALING_PAGE = 300;

export type StealingFilter = { task?: "task1" | "task2"; fn?: PatternFunction; topic?: string; band?: number; saved?: boolean };
export type LibraryPattern = { id: string; pattern: string; fn: PatternFunction; taskType: "task1" | "task2"; topic: string | null; targetBand: number | null; example: string; usageNote: string | null; saved: boolean };

export async function stealingLibrary(userId: string, filter: StealingFilter, database: Database = db) {
  const conds: SQL[] = [livePattern()];
  if (filter.task) conds.push(eq(writingLanguagePatterns.taskType, filter.task));
  if (filter.fn) conds.push(eq(writingLanguagePatterns.function, filter.fn));
  if (filter.topic) conds.push(sql`lower(${writingLanguagePatterns.topic}) = ${filter.topic.toLowerCase()}`);
  if (filter.band) conds.push(eq(writingLanguagePatterns.targetBand, filter.band));
  // The saved-only filter is user-specific, but it is still a FILTER: it has to sit
  // beside publication and the rest, before the limit. It used to be applied in
  // JavaScript to the already-paginated page, so a learner whose saved patterns all
  // sorted beyond row 300 saw an empty saved library while those patterns existed, and
  // `matching`/`hasMore` described the unfiltered set instead of the returned one.
  // As a SQL predicate, returned rows, matching, hasMore and ordering all describe the
  // same effective filter. It is scoped to this user, so nobody else's bank leaks.
  if (filter.saved) {
    conds.push(sql`exists (
      select 1 from ${writingPatternBank}
       where ${writingPatternBank.patternId} = ${writingLanguagePatterns.id}
         and ${writingPatternBank.userId} = ${userId}
    )`);
  }
  // Bounded read with a +1 lookahead: we never load an unbounded list into one response,
  // but a filter combination holding more than STEALING_PAGE live patterns must not be
  // truncated SILENTLY — the caller is told so the UI can ask for narrower filters.
  const windowRows = await database.select({
    id: writingLanguagePatterns.id, pattern: writingLanguagePatterns.pattern, fn: writingLanguagePatterns.function, taskType: writingLanguagePatterns.taskType,
    topic: writingLanguagePatterns.topic, targetBand: writingLanguagePatterns.targetBand, example: writingLanguagePatterns.example, usageNote: writingLanguagePatterns.usageNote,
  }).from(writingLanguagePatterns).where(and(...conds)).orderBy(asc(writingLanguagePatterns.function), asc(writingLanguagePatterns.pattern), asc(writingLanguagePatterns.id)).limit(STEALING_PAGE + 1);
  const hasMore = windowRows.length > STEALING_PAGE;
  const rows = hasMore ? windowRows.slice(0, STEALING_PAGE) : windowRows;
  const [{ matching = 0 } = {}] = await database
    .select({ matching: sql<number>`count(*)::int` })
    .from(writingLanguagePatterns)
    .where(and(...conds));
  const saved = new Set((await database.select({ id: writingPatternBank.patternId }).from(writingPatternBank).where(eq(writingPatternBank.userId, userId))).map((r) => r.id));
  // No post-limit filtering: `conds` already encodes saved-only when it was requested.
  const patterns = rows.map((r): LibraryPattern => ({ ...r, fn: r.fn as PatternFunction, saved: saved.has(r.id) }));
  const allTopics = await database.selectDistinct({ topic: writingLanguagePatterns.topic }).from(writingLanguagePatterns).where(livePattern());
  const bands = await database.selectDistinct({ band: writingLanguagePatterns.targetBand }).from(writingLanguagePatterns).where(livePattern());
  return {
    patterns,
    /** True when more live patterns match this filter than were returned. */
    hasMore,
    /** How many live patterns match the filter in total, so the UI can be specific. */
    matching,
    /** The page size the read was bounded to. */
    pageSize: STEALING_PAGE,
    topics: allTopics.map((t) => t.topic).filter((t): t is string => Boolean(t)).sort(),
    bands: bands.map((b) => b.band).filter((b): b is number => b != null).sort(),
    savedCount: saved.size,
  };
}

/** A NEW topic for practice: any library/model-text topic other than the pattern's own, else a generic label. */
export async function practiceTopics(patternTopic: string | null, database: Database = db): Promise<string[]> {
  const own = (patternTopic ?? "").trim().toLowerCase();
  const fromPatterns = await database.selectDistinct({ t: writingLanguagePatterns.topic }).from(writingLanguagePatterns).where(livePattern());
  const fromTexts = await database.selectDistinct({ t: writingModelTexts.topic }).from(writingModelTexts).where(liveText());
  const all = new Set<string>([...fromPatterns, ...fromTexts].map((r) => (r.t ?? "").trim().toLowerCase()).filter(Boolean));
  for (const f of FALLBACK_TOPICS) all.add(f);
  all.delete(own);
  return [...all].sort();
}

async function findLivePattern(patternId: string, database: Database) {
  const [p] = await database.select().from(writingLanguagePatterns).where(and(eq(writingLanguagePatterns.id, patternId), livePattern()));
  return p ?? null;
}

export async function startPractice(patternId: string, database: Database = db) {
  const p = await findLivePattern(patternId, database);
  if (!p) return null;
  const topics = await practiceTopics(p.topic, database);
  return { patternId: p.id, newTopic: topics[Math.floor(Math.random() * topics.length)]!, topics };
}

export type PracticeOutcome =
  | { ok: true; verdict: CheckResult["verdict"]; copy: CopyCheck; result: CheckResult | null; canSave: boolean; saved: boolean }
  | { ok: false; code: "not_found" | "invalid_topic" | "empty" | "unavailable" | "failed" };

export async function submitPractice(userId: string, language: "uz" | "en", input: { patternId: string; newTopic: string; answer: string }, deps: { database?: Database; check?: Check } = {}): Promise<PracticeOutcome> {
  const database = deps.database ?? db;
  const answer = input.answer.trim();
  if (!answer) return { ok: false, code: "empty" };
  const p = await findLivePattern(input.patternId, database);
  if (!p) return { ok: false, code: "not_found" };
  const topic = input.newTopic.trim().toLowerCase();
  if (!(await practiceTopics(p.topic, database)).includes(topic)) return { ok: false, code: "invalid_topic" };

  const copy = nearCopy(answer, p.example, p.pattern);
  let result: CheckResult | null = null;
  let verdict: CheckResult["verdict"] = "needs_revision";
  if (!copy.nearCopy) {
    const check = deps.check ?? ((u, l, c) => runWritingCheck(u, l, c));
    const outcome = await check(userId, language, { kind: "pattern", pattern: p.pattern, sourceExample: p.example, sourceTopic: p.topic ?? "", newTopic: topic, answer });
    if (!outcome.ok) return { ok: false, code: outcome.reason };
    result = outcome.result;
    const adaptation = result.bands.adaptation;
    verdict = typeof adaptation !== "number" || adaptation < MIN_ADAPTATION_BAND ? "needs_revision" : result.verdict;
  }
  const canSave = verdict !== "needs_revision";
  const [already] = await database.select({ id: writingPatternBank.patternId }).from(writingPatternBank).where(and(eq(writingPatternBank.userId, userId), eq(writingPatternBank.patternId, p.id)));
  await database.insert(activityEvents).values({ userId, type: PATTERN_PRACTICE_EVENT, payload: { patternId: p.id, newTopic: topic, verdict, nearCopy: copy.reason, bands: result?.bands ?? null } });
  return { ok: true, verdict, copy, result, canSave, saved: Boolean(already) };
}

// ---------------------------------------------------------------------------
// 7-step workflow
// ---------------------------------------------------------------------------

export type SourceView = { id: string; title: string; taskType: "task1" | "task2"; topic: string; targetBand: number; patternCount: number };

/** Authorized model texts that have at least one published pattern linked by source_ref. */
export async function stealingSources(database: Database = db): Promise<SourceView[]> {
  const rows = await database.select({
    id: writingModelTexts.id, title: writingModelTexts.title, taskType: writingModelTexts.taskType, topic: writingModelTexts.topic, targetBand: writingModelTexts.targetBand,
    patternCount: sql<number>`(select count(*)::int from writing_language_patterns p where p.source_ref = writing_model_texts.id::text and p.publication_state = 'published' and (p.publish_at is null or p.publish_at <= now()))`,
  }).from(writingModelTexts).where(liveText()).orderBy(asc(writingModelTexts.title));
  return rows.filter((r) => r.patternCount > 0).map((r) => ({ ...r, targetBand: Number(r.targetBand) }));
}

type Session = typeof writingStealingSessions.$inferSelect;
export type StealingView = {
  id: string; step: number; source: { id: string; title: string; taskType: "task1" | "task2"; topic: string; targetBand: number };
  brainstorm: string | null; draft: string | null; comparison: string | null; rewrite: string | null;
  /** Model text body: step 1 (source), steps 4–6 and after completion; hidden during brainstorm/draft and the Day-3 rewrite. */
  modelBody: string | null;
  patterns: { id: string; pattern: string; fn: PatternFunction; example: string; usageNote: string | null }[] | null;
  selectedPatternIds: string[]; memorisedPatternIds: string[]; rewritePatternIds: string[];
  rewriteAvailableAt: string | null; rewriteUnlocked: boolean; completedAt: string | null;
};

/** Recall cue: the example with the pattern's own words blanked out. */
function maskPattern(example: string, pattern: string): string {
  const words = new Set(activationTokens(pattern).filter((w) => w.length > 2 || !["a", "an"].includes(w)));
  return example.replace(/[\p{L}\p{N}']+/gu, (w) => (words.has(w.toLowerCase()) ? "_".repeat(Math.max(3, w.length)) : w));
}

async function view(s: Session, database: Database, now: Date): Promise<StealingView> {
  const [t] = await database.select().from(writingModelTexts).where(eq(writingModelTexts.id, s.modelTextId));
  const linked = s.step >= 4 ? await database.select().from(writingLanguagePatterns).where(and(eq(writingLanguagePatterns.sourceRef, s.modelTextId), livePattern())).orderBy(asc(writingLanguagePatterns.function)) : [];
  const rewriteUnlocked = Boolean(s.rewriteAvailableAt && s.rewriteAvailableAt <= now);
  // Step 1 = read the authorized source essay. Steps 2–3 hide it so brainstorm/draft are the learner's own
  // work (no copying while drafting); Steps 4–6 bring it back for analysis; the Day-3 rewrite hides it again;
  // once completed it is shown for comparison.
  const showModel = s.step === 1 || (s.step >= 4 && s.step < 7) || Boolean(s.completedAt);
  // Step 6 is recall: the pattern text is the answer, so it is only listed for selection/analysis steps.
  const patterns = s.step >= 4 ? linked.map((p) => ({ id: p.id, pattern: p.pattern, fn: p.function as PatternFunction, example: p.example, usageNote: p.usageNote })) : null;
  return {
    id: s.id, step: s.step,
    source: { id: t!.id, title: t!.title, taskType: t!.taskType, topic: t!.topic, targetBand: Number(t!.targetBand) },
    brainstorm: s.brainstorm, draft: s.draft, comparison: s.comparison, rewrite: s.rewrite,
    modelBody: showModel ? t!.body : null,
    patterns: s.step === 6 || (s.step === 7 && !s.completedAt) ? (patterns ?? []).filter((p) => s.selectedPatternIds.includes(p.id)).map((p) => (s.step === 6 && !s.memorisedPatternIds.includes(p.id) ? { ...p, pattern: "", example: maskPattern(p.example, p.pattern) } : p)) : patterns,
    selectedPatternIds: s.selectedPatternIds, memorisedPatternIds: s.memorisedPatternIds, rewritePatternIds: s.rewritePatternIds,
    rewriteAvailableAt: s.rewriteAvailableAt?.toISOString() ?? null, rewriteUnlocked, completedAt: s.completedAt?.toISOString() ?? null,
  };
}

export async function startStealing(userId: string, modelTextId: string, database: Database = db, now = new Date()) {
  const sources = await stealingSources(database);
  if (!sources.some((s) => s.id === modelTextId)) return null;
  await database.insert(writingStealingSessions).values({ userId, modelTextId }).onConflictDoNothing();
  const [s] = await database.select().from(writingStealingSessions).where(and(eq(writingStealingSessions.userId, userId), eq(writingStealingSessions.modelTextId, modelTextId)));
  return view(s!, database, now);
}

export async function getStealing(userId: string, id: string, database: Database = db, now = new Date()) {
  const [s] = await database.select().from(writingStealingSessions).where(and(eq(writingStealingSessions.id, id), eq(writingStealingSessions.userId, userId)));
  return s ? view(s, database, now) : null;
}

export async function listStealing(userId: string, database: Database = db) {
  return database.select({ id: writingStealingSessions.id, modelTextId: writingStealingSessions.modelTextId, step: writingStealingSessions.step, completedAt: writingStealingSessions.completedAt, rewriteAvailableAt: writingStealingSessions.rewriteAvailableAt })
    .from(writingStealingSessions).where(eq(writingStealingSessions.userId, userId)).orderBy(desc(writingStealingSessions.updatedAt));
}

export type StepAction =
  | { action: "read" }
  | { action: "brainstorm"; text: string }
  | { action: "draft"; text: string }
  | { action: "analyse"; patternIds: string[] }
  | { action: "compare"; text: string }
  | { action: "recall"; patternId: string; attempt: string }
  | { action: "rewrite"; text: string };

export type StepOutcome = { ok: true; view: StealingView; recalled?: boolean } | { ok: false; code: "not_found" | "wrong_step" | "too_short" | "invalid" | "locked" };

const ORDER: Record<StepAction["action"], number> = { read: 1, brainstorm: 2, draft: 3, analyse: 4, compare: 5, recall: 6, rewrite: 7 };

/** Server-enforced progression: each step validates its own work before the next unlocks. */
export async function advanceStealing(userId: string, id: string, a: StepAction, database: Database = db, now = new Date()): Promise<StepOutcome> {
  const [s] = await database.select().from(writingStealingSessions).where(and(eq(writingStealingSessions.id, id), eq(writingStealingSessions.userId, userId)));
  if (!s) return { ok: false, code: "not_found" };
  if (s.completedAt || s.step !== ORDER[a.action]) return { ok: false, code: "wrong_step" };
  const set: Partial<typeof writingStealingSessions.$inferInsert> = { updatedAt: now };
  let recalled: boolean | undefined;
  switch (a.action) {
    case "read": set.step = 2; break;
    case "brainstorm": if (wordCount(a.text) < MIN_BRAINSTORM_WORDS) return { ok: false, code: "too_short" }; set.brainstorm = a.text.trim(); set.step = 3; break;
    case "draft": if (wordCount(a.text) < MIN_DRAFT_WORDS) return { ok: false, code: "too_short" }; set.draft = a.text.trim(); set.step = 4; break;
    case "analyse": {
      const linked = await database.select({ id: writingLanguagePatterns.id }).from(writingLanguagePatterns).where(and(eq(writingLanguagePatterns.sourceRef, s.modelTextId), livePattern()));
      const ids = [...new Set(a.patternIds)].filter((x) => linked.some((l) => l.id === x));
      if (!ids.length) return { ok: false, code: "invalid" };
      set.selectedPatternIds = ids; set.step = 5; break;
    }
    case "compare": if (wordCount(a.text) < MIN_COMPARE_WORDS) return { ok: false, code: "too_short" }; set.comparison = a.text.trim(); set.step = 6; break;
    case "recall": {
      if (!s.selectedPatternIds.includes(a.patternId)) return { ok: false, code: "invalid" };
      const [p] = await database.select({ pattern: writingLanguagePatterns.pattern }).from(writingLanguagePatterns).where(eq(writingLanguagePatterns.id, a.patternId));
      recalled = Boolean(p) && activationMatchKey(a.attempt) === activationMatchKey(p!.pattern);
      if (recalled) {
        const mem = [...new Set([...s.memorisedPatternIds, a.patternId])];
        set.memorisedPatternIds = mem;
        if (s.selectedPatternIds.every((x) => mem.includes(x))) {
          set.step = 7;
          set.rewriteAvailableAt = new Date(now.getTime() + REWRITE_DELAY_DAYS * 86_400_000);
        }
      }
      break;
    }
    case "rewrite": {
      if (!s.rewriteAvailableAt || s.rewriteAvailableAt > now) return { ok: false, code: "locked" };
      if (wordCount(a.text) < MIN_DRAFT_WORDS) return { ok: false, code: "too_short" };
      const pats = await database.select({ id: writingLanguagePatterns.id, pattern: writingLanguagePatterns.pattern }).from(writingLanguagePatterns).where(inArray(writingLanguagePatterns.id, s.selectedPatternIds.length ? s.selectedPatternIds : ["00000000-0000-0000-0000-000000000000"]));
      set.rewrite = a.text.trim(); set.rewritePatternIds = patternsUsed(a.text, pats); set.completedAt = now; break;
    }
  }
  const [u] = await database.update(writingStealingSessions).set(set).where(and(eq(writingStealingSessions.id, id), eq(writingStealingSessions.step, s.step))).returning();
  if (!u) return { ok: false, code: "wrong_step" };
  return { ok: true, view: await view(u, database, now), recalled };
}
