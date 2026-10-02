import "server-only";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { writingTranslationAnswers, writingTranslationAttempts, writingTranslationSentences, writingTranslationSets } from "@/db/schema";
import { liveWhere } from "@/lib/services/cms/publication";
import { runWritingCheck, type CheckOutcome } from "@/lib/services/writing/check";
import type { WritingCheckInput } from "@/lib/services/coach/types";
import { matchesAccepted, MAX_TRIES, TRANSLATION_QUESTION_TYPES, type TranslationQuestionType } from "@/lib/writing/translation-rules";

type Database = typeof db;
type Check = (userId: string, language: "uz" | "en", check: WritingCheckInput) => Promise<CheckOutcome>;

/**
 * Translation trainer (§40 / PDF pp.8–10). The answer-leak rule is structural:
 * the in-progress view is built from a column list that never includes
 * model_english / accepted_alternatives / notes for the current or any future
 * sentence. Reference English is revealed only for sentences already finished.
 */

export type SetSummary = { id: string; title: string; topic: string; questionType: TranslationQuestionType; targetBand: number; sentences: number };

const live = () => liveWhere({ publicationState: writingTranslationSets.publicationState, publishAt: writingTranslationSets.publishAt });

export async function listTranslationSets(database: Database = db): Promise<SetSummary[]> {
  const rows = await database.select({
    id: writingTranslationSets.id, title: writingTranslationSets.title, topic: writingTranslationSets.topic,
    questionType: writingTranslationSets.questionType, targetBand: writingTranslationSets.targetBand,
    sentences: count(writingTranslationSentences.id),
  }).from(writingTranslationSets)
    .innerJoin(writingTranslationSentences, eq(writingTranslationSentences.setId, writingTranslationSets.id))
    .where(live())
    .groupBy(writingTranslationSets.id)
    .orderBy(asc(writingTranslationSets.topic), asc(writingTranslationSets.title));
  return rows.map((r) => ({ ...r, questionType: r.questionType as TranslationQuestionType, sentences: Number(r.sentences) }));
}

export type StartInput = { setId?: string; random?: { questionType?: TranslationQuestionType; targetBand?: number } };

export async function startTranslationAttempt(userId: string, input: StartInput, database: Database = db) {
  let setId = input.setId ?? null;
  if (setId) {
    const [ok] = await database.select({ id: writingTranslationSets.id }).from(writingTranslationSets).where(and(eq(writingTranslationSets.id, setId), live()));
    if (!ok) return { ok: false as const, code: "not_found" as const };
  } else {
    const filters = [live()];
    if (input.random?.questionType && TRANSLATION_QUESTION_TYPES.includes(input.random.questionType)) filters.push(eq(writingTranslationSets.questionType, input.random.questionType));
    if (input.random?.targetBand) filters.push(eq(writingTranslationSets.targetBand, input.random.targetBand));
    const [pick] = await database.select({ id: writingTranslationSets.id }).from(writingTranslationSets)
      .where(and(...filters, sql`exists (select 1 from writing_translation_sentences s where s.set_id = ${writingTranslationSets.id})`))
      .orderBy(sql`random()`).limit(1);
    if (!pick) return { ok: false as const, code: "no_sets" as const };
    setId = pick.id;
  }
  // Resume an unfinished attempt on the same set instead of starting over.
  const [open] = await database.select({ id: writingTranslationAttempts.id }).from(writingTranslationAttempts)
    .where(and(eq(writingTranslationAttempts.userId, userId), eq(writingTranslationAttempts.setId, setId), eq(writingTranslationAttempts.status, "in_progress")))
    .orderBy(desc(writingTranslationAttempts.startedAt)).limit(1);
  if (open) return { ok: true as const, attemptId: open.id, resumed: true };
  const [created] = await database.insert(writingTranslationAttempts).values({ userId, setId }).returning({ id: writingTranslationAttempts.id });
  return { ok: true as const, attemptId: created!.id, resumed: false };
}

type SentenceRow = typeof writingTranslationSentences.$inferSelect;
type AnswerRow = typeof writingTranslationAnswers.$inferSelect;

/** A sentence is finished once it is accepted, could not be checked, or used all its tries. */
export function isFinished(a: Pick<AnswerRow, "verdict" | "evaluationStatus" | "tries"> | undefined): boolean {
  if (!a) return false;
  if (a.evaluationStatus === "unavailable") return true;
  return a.verdict === "correct" || a.verdict === "acceptable" || a.tries >= MAX_TRIES;
}

async function loadAttempt(userId: string, attemptId: string, database: Database) {
  const [attempt] = await database.select().from(writingTranslationAttempts)
    .where(and(eq(writingTranslationAttempts.id, attemptId), eq(writingTranslationAttempts.userId, userId)));
  if (!attempt) return null;
  const [set] = await database.select().from(writingTranslationSets).where(eq(writingTranslationSets.id, attempt.setId));
  const sentences = await database.select().from(writingTranslationSentences).where(eq(writingTranslationSentences.setId, attempt.setId)).orderBy(asc(writingTranslationSentences.position));
  const answers = await database.select().from(writingTranslationAnswers).where(eq(writingTranslationAnswers.attemptId, attemptId));
  const bySentence = new Map(answers.map((a) => [a.sentenceId, a]));
  const current = sentences.find((s) => !isFinished(bySentence.get(s.id))) ?? null;
  return { attempt, set: set!, sentences, bySentence, current };
}

export type FinishedSentence = {
  position: number; uzbek: string; yours: string; model: string; notes: string[];
  verdict: string | null; status: string; meaning: number | null; feedback: string | null; improved: string | null;
};
export type TranslationView = {
  attemptId: string; status: "in_progress" | "completed";
  set: { title: string; topic: string; questionType: TranslationQuestionType; targetBand: number; prompt: string };
  total: number;
  finished: FinishedSentence[];
  /** Only the current sentence's Uzbek source — never any English reference. */
  current: { position: number; uzbek: string; lastAnswer: string | null; lastFeedback: string | null; lastImproved: string | null; tries: number } | null;
  result: TranslationResult | null;
};
export type TranslationResult = {
  overall: number | null; meaning: number | null; grammar: number | null; vocabulary: number | null;
  bandWords: { used: string[]; total: number }; elapsedMs: number | null; topFixes: { position: number; text: string }[]; checked: number;
};

function finishedOf(s: SentenceRow, a: AnswerRow): FinishedSentence {
  return {
    position: s.position, uzbek: s.uzbekSource, yours: a.answerText, model: s.modelEnglish, notes: s.notes ?? [],
    verdict: a.verdict, status: a.evaluationStatus, meaning: a.meaningPreserved, feedback: a.feedback, improved: a.improvedVersion,
  };
}

export async function getTranslationView(userId: string, attemptId: string, database: Database = db): Promise<TranslationView | null> {
  const loaded = await loadAttempt(userId, attemptId, database);
  if (!loaded) return null;
  const { attempt, set, sentences, bySentence, current } = loaded;
  const finished = sentences.filter((s) => isFinished(bySentence.get(s.id))).map((s) => finishedOf(s, bySentence.get(s.id)!));
  const last = current ? bySentence.get(current.id) : undefined;
  return {
    attemptId, status: attempt.status as "in_progress" | "completed",
    set: { title: set.title, topic: set.topic, questionType: set.questionType as TranslationQuestionType, targetBand: set.targetBand, prompt: set.promptText },
    total: sentences.length,
    finished,
    current: current ? { position: current.position, uzbek: current.uzbekSource, lastAnswer: last?.answerText ?? null, lastFeedback: last?.feedback ?? null, lastImproved: last?.improvedVersion ?? null, tries: last?.tries ?? 0 } : null,
    result: attempt.status === "completed" ? buildResult(attempt, sentences, bySentence) : null,
  };
}

/** Deterministic from persisted rows, so a reload reproduces the same result. */
export function buildResult(
  attempt: Pick<typeof writingTranslationAttempts.$inferSelect, "overallEstimate" | "meaningScore" | "grammarBand" | "vocabularyBand" | "elapsedMs">,
  sentences: SentenceRow[], bySentence: Map<string, AnswerRow>,
): TranslationResult {
  const targets = [...new Set(sentences.flatMap((s) => s.targetLexicalItems ?? []).map((w) => w.trim()).filter(Boolean))];
  const answersText = sentences.map((s) => bySentence.get(s.id)?.answerText ?? "").join(" \n ").toLowerCase();
  const used = targets.filter((w) => answersText.includes(w.toLowerCase()));
  const fixes = sentences
    .map((s) => ({ s, a: bySentence.get(s.id) }))
    .filter((x) => x.a && x.a.verdict === "needs_revision" && (x.a.feedback || x.a.improvedVersion))
    .sort((x, y) => (x.a!.meaningPreserved ?? 0) - (y.a!.meaningPreserved ?? 0) || x.s.position - y.s.position)
    .slice(0, 3)
    .map((x) => ({ position: x.s.position, text: x.a!.feedback ?? x.a!.improvedVersion! }));
  return {
    overall: attempt.overallEstimate, meaning: attempt.meaningScore, grammar: attempt.grammarBand, vocabulary: attempt.vocabularyBand,
    bandWords: { used, total: targets.length }, elapsedMs: attempt.elapsedMs, topFixes: fixes,
    checked: sentences.filter((s) => { const a = bySentence.get(s.id); return a && a.evaluationStatus !== "unavailable"; }).length,
  };
}

const half = (n: number) => Math.round(n * 2) / 2;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export type SubmitResult =
  | { ok: true; view: TranslationView; verdict: "correct" | "acceptable" | "needs_revision" | "unchecked" }
  | { ok: false; code: "not_found" | "completed" | "not_current" | "empty" };

/**
 * Check the CURRENT sentence. Stage A: normalized match against the model and
 * reviewed alternatives (no AI call). Stage B: external AI semantic check for
 * anything else. AI unavailable → saved honestly as "not checked", no verdict.
 */
export async function submitTranslationAnswer(
  userId: string, attemptId: string, position: number, answer: string, language: "uz" | "en",
  deps: { database?: Database; check?: Check; aiReady?: boolean } = {},
): Promise<SubmitResult> {
  const database = deps.database ?? db;
  const text = answer.trim();
  if (!text) return { ok: false, code: "empty" };
  const loaded = await loadAttempt(userId, attemptId, database);
  if (!loaded) return { ok: false, code: "not_found" };
  if (loaded.attempt.status === "completed") return { ok: false, code: "completed" };
  const s = loaded.current;
  if (!s || s.position !== position) return { ok: false, code: "not_current" };
  const prev = loaded.bySentence.get(s.id);

  let row: Omit<typeof writingTranslationAnswers.$inferInsert, "attemptId" | "sentenceId">;
  if (matchesAccepted(text, [s.modelEnglish, ...(s.acceptedAlternatives ?? [])])) {
    row = { answerText: text, evaluationStatus: "exact", verdict: "correct", meaningPreserved: 100, grammarBand: null, vocabularyBand: null, feedback: null, improvedVersion: null };
  } else if (deps.aiReady === false) {
    row = { answerText: text, evaluationStatus: "unavailable", verdict: null, meaningPreserved: null, grammarBand: null, vocabularyBand: null, feedback: null, improvedVersion: null };
  } else {
    const check = deps.check ?? ((u, l, c) => runWritingCheck(u, l, c));
    const outcome = await check(userId, language, {
      kind: "translation", uzbekSource: s.uzbekSource, referenceEnglish: s.modelEnglish,
      acceptedAlternatives: s.acceptedAlternatives ?? [], targetBand: loaded.set.targetBand, answer: text,
    });
    if (!outcome.ok) {
      row = { answerText: text, evaluationStatus: "unavailable", verdict: null, meaningPreserved: null, grammarBand: null, vocabularyBand: null, feedback: null, improvedVersion: null };
    } else {
      const r = outcome.result;
      row = {
        answerText: text, evaluationStatus: "evaluated", verdict: r.verdict,
        meaningPreserved: r.bands.meaning == null ? null : Math.round((r.bands.meaning / 9) * 100),
        grammarBand: r.bands.grammar, vocabularyBand: r.bands.vocabulary,
        feedback: r.feedback, improvedVersion: r.improved,
      };
    }
  }
  const tries = (prev?.tries ?? 0) + 1;
  await database.insert(writingTranslationAnswers).values({ attemptId, sentenceId: s.id, ...row, tries })
    .onConflictDoUpdate({ target: [writingTranslationAnswers.attemptId, writingTranslationAnswers.sentenceId], set: { ...row, tries } });

  await maybeComplete(userId, attemptId, database);
  const view = (await getTranslationView(userId, attemptId, database))!;
  return { ok: true, view, verdict: row.evaluationStatus === "unavailable" ? "unchecked" : (row.verdict as "correct" | "acceptable" | "needs_revision") };
}

async function maybeComplete(userId: string, attemptId: string, database: Database) {
  const loaded = await loadAttempt(userId, attemptId, database);
  if (!loaded || loaded.current || loaded.attempt.status === "completed") return;
  const answers = loaded.sentences.map((s) => loaded.bySentence.get(s.id)!);
  const band = loaded.set.targetBand;
  // An exact match to reviewed reference wording counts at the set's target band.
  const grammar = mean(answers.filter((a) => a.evaluationStatus !== "unavailable").map((a) => a.evaluationStatus === "exact" ? band : a.grammarBand).filter((n): n is number => n != null));
  const vocab = mean(answers.filter((a) => a.evaluationStatus !== "unavailable").map((a) => a.evaluationStatus === "exact" ? band : a.vocabularyBand).filter((n): n is number => n != null));
  const meaning = mean(answers.map((a) => a.meaningPreserved).filter((n): n is number => n != null));
  const overall = grammar != null && vocab != null ? half((grammar + vocab) / 2) : null;
  await database.update(writingTranslationAttempts).set({
    status: "completed", completedAt: sql`now()`,
    elapsedMs: sql`(extract(epoch from (now() - ${writingTranslationAttempts.startedAt})) * 1000)::int`,
    overallEstimate: overall, meaningScore: meaning == null ? null : Math.round(meaning),
    grammarBand: grammar == null ? null : half(grammar), vocabularyBand: vocab == null ? null : half(vocab),
  }).where(and(eq(writingTranslationAttempts.id, attemptId), eq(writingTranslationAttempts.status, "in_progress")));
}

export async function listMyTranslationAttempts(userId: string, database: Database = db) {
  return database.select({
    id: writingTranslationAttempts.id, title: writingTranslationSets.title, status: writingTranslationAttempts.status,
    startedAt: writingTranslationAttempts.startedAt, overall: writingTranslationAttempts.overallEstimate,
  }).from(writingTranslationAttempts)
    .innerJoin(writingTranslationSets, eq(writingTranslationSets.id, writingTranslationAttempts.setId))
    .where(eq(writingTranslationAttempts.userId, userId))
    .orderBy(desc(writingTranslationAttempts.startedAt)).limit(8);
}
