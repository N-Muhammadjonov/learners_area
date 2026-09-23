import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { coachWeaknesses } from "@/db/schema";
import { WEAKNESS_CATEGORY_META, isWeaknessCategory, type WeaknessArea } from "./categories";

/**
 * StudyRecommendationService.
 *
 * Turns the learner's stored weakness history into a short, ordered practice
 * list. It answers "what should I practise now?" from rows that real
 * evaluations produced — the same rows, whatever evaluator wrote them, because
 * RIWI and a future external provider share one weakness vocabulary.
 *
 * Two properties this service deliberately has:
 *   - Nothing is invented. A learner with no weakness rows gets no advice.
 *   - It ranks and groups instead of dumping. Ten open categories become at
 *     most `limit` actions, one per practice area, strongest signal first.
 */

export type WeaknessSignal = {
  category: string;
  occurrenceCount: number;
  recentSeverity: string;
  status: "open" | "improving" | "resolved";
  lastSeenAt: Date;
};

export type StudyRecommendation = {
  area: WeaknessArea;
  href: string;
  /** Every flagged signal in this area, strongest first. */
  categories: string[];
  /** The concrete action to take, taken from the strongest category. */
  reason: string;
  /** How many times the strongest signal was seen. */
  occurrenceCount: number;
};

const SEVERITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };
const STATUS_WEIGHT: Record<WeaknessSignal["status"], number> = {
  open: 3,
  improving: 1,
  resolved: 0,
};

/**
 * Ranking is explainable on purpose: severity and how often the pattern was
 * seen decide the order, a resolved pattern drops out, and nothing else
 * influences it.
 */
function scoreSignal(signal: WeaknessSignal): number {
  const severity = SEVERITY_WEIGHT[signal.recentSeverity] ?? 1;
  const occurrences = Math.min(signal.occurrenceCount, 5);
  return severity * 2 + occurrences + STATUS_WEIGHT[signal.status];
}

export function buildStudyRecommendations(
  signals: readonly WeaknessSignal[],
  limit = 3
): StudyRecommendation[] {
  const ranked = signals
    .flatMap((signal) => {
      if (!isWeaknessCategory(signal.category)) return [];
      // A resolved pattern is not something to practise: it stays visible in the
      // "what improved" list, and recommending it again would be noise.
      if (signal.status === "resolved") return [];
      return [{ signal, meta: WEAKNESS_CATEGORY_META[signal.category], score: scoreSignal(signal) }];
    })
    .sort((a, b) => b.score - a.score);

  // Internal view: the ranking score never leaves this function.
  const byArea = new Map<WeaknessArea, StudyRecommendation & { score: number }>();

  for (const entry of ranked) {
    const existing = byArea.get(entry.meta.area);
    if (existing) {
      // Same practice target: one action, and the other signals in the area are
      // named so the learner can see what the action covers.
      existing.categories.push(entry.signal.category);
      existing.score += Math.min(entry.score, 3);
      continue;
    }
    byArea.set(entry.meta.area, {
      area: entry.meta.area,
      href: entry.meta.href,
      categories: [entry.signal.category],
      reason: entry.meta.action,
      occurrenceCount: entry.signal.occurrenceCount,
      score: entry.score,
    });
  }

  return [...byArea.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry): StudyRecommendation => ({
      area: entry.area,
      href: entry.href,
      categories: entry.categories,
      reason: entry.reason,
      occurrenceCount: entry.occurrenceCount,
    }));
}

/** The service entry point: recommendations for one learner, from their own rows. */
export async function getStudyRecommendations(
  userId: string,
  limit = 3
): Promise<StudyRecommendation[]> {
  const rows = await db
    .select({
      category: coachWeaknesses.category,
      occurrenceCount: coachWeaknesses.occurrenceCount,
      recentSeverity: coachWeaknesses.recentSeverity,
      status: coachWeaknesses.status,
      lastSeenAt: coachWeaknesses.lastSeenAt,
    })
    .from(coachWeaknesses)
    .where(eq(coachWeaknesses.userId, userId))
    .orderBy(desc(coachWeaknesses.lastSeenAt));

  return buildStudyRecommendations(rows, limit);
}
