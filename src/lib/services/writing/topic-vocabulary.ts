import "server-only";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { lexemes, userVocabulary, writingLanguagePatterns, writingPatternBank } from "@/db/schema";
import { liveWhere } from "@/lib/services/cms/publication";
import { TOPIC_PACKS, type PackWord } from "@/lib/services/vocabulary/packs";
import type { PatternFunction } from "@/lib/writing/pattern-functions";

type Database = typeof db;

/**
 * Topic Vocabulary (§43 / PDF p.13). No Writing-only lexical store: words are
 * the canonical authored topic packs (saved through the one vocabulary
 * engine), phrases/frames are published writing_language_patterns, and the
 * saved state is read from the learner's real user_vocabulary and pattern bank.
 */

export type TopicFilter = { topic?: string; task?: "task1" | "task2"; fn?: PatternFunction };
export type PatternView = { id: string; pattern: string; fn: PatternFunction; taskType: "task1" | "task2"; topic: string | null; targetBand: number | null; example: string; usageNote: string | null; saved: boolean };
export type WordView = PackWord & { packId: string; saved: boolean };

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export async function topicVocabulary(userId: string, filter: TopicFilter, database: Database = db) {
  const conds: SQL[] = [liveWhere({ publicationState: writingLanguagePatterns.publicationState, publishAt: writingLanguagePatterns.publishAt })];
  if (filter.task) conds.push(eq(writingLanguagePatterns.taskType, filter.task));
  if (filter.fn) conds.push(eq(writingLanguagePatterns.function, filter.fn));
  const all = await database.select().from(writingLanguagePatterns).where(and(...conds))
    .orderBy(asc(writingLanguagePatterns.topic), asc(writingLanguagePatterns.function), asc(writingLanguagePatterns.pattern));

  // Topics = authored packs + pattern topics (one list, stable ids).
  const topics = new Map<string, { id: string; label: { en: string; uz: string } }>();
  for (const p of TOPIC_PACKS) topics.set(p.id, { id: p.id, label: p.label });
  for (const p of all) if (p.topic) { const id = slug(p.topic); if (!topics.has(id)) topics.set(id, { id, label: { en: p.topic, uz: p.topic } }); }

  const patterns = filter.topic ? all.filter((p) => !p.topic || slug(p.topic) === filter.topic) : all;
  const packs = filter.topic ? TOPIC_PACKS.filter((p) => p.id === filter.topic) : TOPIC_PACKS;
  // Pack words are general academic vocabulary for both tasks; a Task 1 filter shows Task 1 language (trends, comparison) first.
  const words = filter.fn && filter.fn !== "collocation" ? [] : packs.flatMap((p) => p.words.map((w) => ({ ...w, packId: p.id })));

  const savedPatternIds = patterns.length
    ? new Set((await database.select({ id: writingPatternBank.patternId }).from(writingPatternBank)
      .where(and(eq(writingPatternBank.userId, userId), inArray(writingPatternBank.patternId, patterns.map((p) => p.id))))).map((r) => r.id))
    : new Set<string>();
  const terms = [...new Set(words.map((w) => w.term.toLowerCase()))];
  const savedTerms = terms.length
    ? new Set((await database.select({ term: sql<string>`lower(${lexemes.term})` }).from(userVocabulary)
      .innerJoin(lexemes, eq(lexemes.id, userVocabulary.lexemeId))
      .where(and(eq(userVocabulary.userId, userId), inArray(sql`lower(${lexemes.term})`, terms)))).map((r) => r.term))
    : new Set<string>();

  return {
    topics: [...topics.values()],
    words: words.map((w): WordView => ({ ...w, saved: savedTerms.has(w.term.toLowerCase()) })),
    patterns: patterns.map((p): PatternView => ({
      id: p.id, pattern: p.pattern, fn: p.function as PatternFunction, taskType: p.taskType, topic: p.topic,
      targetBand: p.targetBand, example: p.example, usageNote: p.usageNote, saved: savedPatternIds.has(p.id),
    })),
  };
}

/** Save / unsave a published pattern in the learner's pattern bank (idempotent). */
export async function setPatternSaved(userId: string, patternId: string, saved: boolean, database: Database = db) {
  const [p] = await database.select({ id: writingLanguagePatterns.id }).from(writingLanguagePatterns)
    .where(and(eq(writingLanguagePatterns.id, patternId), liveWhere({ publicationState: writingLanguagePatterns.publicationState, publishAt: writingLanguagePatterns.publishAt })));
  if (!p) return false;
  if (saved) await database.insert(writingPatternBank).values({ userId, patternId }).onConflictDoNothing();
  else await database.delete(writingPatternBank).where(and(eq(writingPatternBank.userId, userId), eq(writingPatternBank.patternId, patternId)));
  return true;
}
