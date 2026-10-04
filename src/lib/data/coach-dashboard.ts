import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { coachWeaknesses, evaluations, lexemes, userVocabulary } from "@/db/schema";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { WEAKNESS_CATEGORY_META, isWeaknessCategory } from "@/lib/services/coach/categories";

/**
 * The Coach dashboard's data.
 *
 * Everything here comes from rows the student's own work produced: weakness
 * rows written from real evaluations, evaluation rows, and the spaced-repetition
 * queue. There is no synthetic trend line and no placeholder percentage — a
 * section with no data says so.
 */

export type WeaknessSummary = {
  category: string;
  label: string;
  area: string;
  href: string;
  action: string;
  occurrenceCount: number;
  recentSeverity: string;
  status: "open" | "improving" | "resolved";
  lastSeenAt: Date;
};

export async function getWeaknessSummary(userId: string, database: typeof db = db): Promise<WeaknessSummary[]> {
  const rows = await database
    .select()
    .from(coachWeaknesses)
    .where(eq(coachWeaknesses.userId, userId))
    .orderBy(desc(coachWeaknesses.lastSeenAt));

  return rows.flatMap((row) => {
    if (!isWeaknessCategory(row.category)) return [];
    const meta = WEAKNESS_CATEGORY_META[row.category];
    return [
      {
        category: row.category,
        label: meta.label,
        area: meta.area,
        href: meta.href,
        action: meta.action,
        occurrenceCount: row.occurrenceCount,
        recentSeverity: row.recentSeverity,
        status: row.status,
        lastSeenAt: row.lastSeenAt,
      },
    ];
  });
}

export async function getRecentEvaluations(userId: string, limit = 8) {
  const rows = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.userId, userId))
    .orderBy(desc(evaluations.createdAt))
    .limit(limit);
  // Learner surface: legacy rows may hold a vendor label; the public label is always RIWI.
  return rows.map((row) => ({ ...row, checkedByName: PUBLIC_CHECKED_BY }));
}

export async function getEvaluationCount(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(evaluations)
    .where(eq(evaluations.userId, userId));
  return rows[0]?.count ?? 0;
}

/** Words whose review date has arrived — the "what should I review today?" answer. */
export async function getDueVocabulary(userId: string, limit = 10, database: typeof db = db) {
  return database
    .select({
      id: userVocabulary.id,
      state: userVocabulary.state,
      nextReviewAt: userVocabulary.nextReviewAt,
      term: lexemes.term,
      definitionEn: lexemes.definitionEn,
    })
    .from(userVocabulary)
    .innerJoin(lexemes, eq(userVocabulary.lexemeId, lexemes.id))
    .where(and(eq(userVocabulary.userId, userId), lte(userVocabulary.nextReviewAt, new Date())))
    .orderBy(userVocabulary.nextReviewAt)
    .limit(limit);
}
