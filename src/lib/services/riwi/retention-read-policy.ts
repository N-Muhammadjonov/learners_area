import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { hasDictionaryAssistanceLock } from "./dictionary";

export function isRetentionLearningIntent(intent: unknown): boolean {
  return intent === "retention_recall" || intent === "retention_vocabulary" || intent === "retention_error_pattern" || intent === "grammar_retention";
}

/** Same keys and stable order as the existing canonical recall allocator. */
export async function lockRecallAllocation(userId: string, database: Pick<typeof db, "execute">): Promise<void> {
  for (const level of ["A2", "B1", "B2", "C1", "C2"])
    await database.execute(sql`select pg_advisory_xact_lock(hashtext(${`retention.start:${userId}:${level}`}))`);
}

/** Treat every role's own active attempt as an exam boundary. Older stored
 * assistance cannot become a transcript-read bypass during a new recall. */
export async function hasActiveLearningAttempt(userId: string, database: Pick<typeof db, "select">): Promise<boolean> {
  return hasDictionaryAssistanceLock({ id: userId, role: "student" }, database);
}
