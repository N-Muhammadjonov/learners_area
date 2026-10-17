import "server-only";
import { count, desc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { grammarTopics, listeningTests, readingPassages, videoLessons, writingPrompts } from "@/db/schema";
import { liveWhere } from "@/lib/services/cms/publication";

/** Same publication truth as the content index, with bounded aggregate results. */
export async function contentInventory(database = db, now = new Date()) {
  const totals = async (table: typeof readingPassages | typeof listeningTests | typeof writingPrompts | typeof videoLessons) => {
    const [row] = await database.select({ total: count(), live: sql<number>`count(*) filter (where ${liveWhere(table, now)})::integer` }).from(table);
    return { total: Number(row?.total ?? 0), live: Number(row?.live ?? 0) };
  };
  const [reading, listening, writing, grammarRows, video] = await Promise.all([
    totals(readingPassages), totals(listeningTests), totals(writingPrompts),
    database.select({ total: count() }).from(grammarTopics), totals(videoLessons),
  ]);
  const grammar = { total: Number(grammarRows[0]?.total ?? 0), live: Number(grammarRows[0]?.total ?? 0) };
  return { reading, listening, writing, grammar, video };
}

/** The Reading management list uses metadata; passage bodies belong to its editor. */
export function adminReadingCards(database = db) {
  return database.select({ id: readingPassages.id, title: readingPassages.title,
    difficultyLevel: readingPassages.difficultyLevel, suggestedMinutes: readingPassages.suggestedMinutes,
    publicationState: readingPassages.publicationState, publishAt: readingPassages.publishAt,
  }).from(readingPassages).orderBy(desc(readingPassages.createdAt));
}
