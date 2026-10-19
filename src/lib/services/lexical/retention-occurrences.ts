import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lexicalOccurrences, lexemes, retentionAttempts, retentionTextVersions } from "@/db/schema";
import { resolvePhase } from "@/lib/retention/phase";
import { occurrenceSpans } from "./occurrence-spans";
import type { OccurrenceResolution } from "./context";
import { sentenceAt } from "./listening-occurrences";

/** Every lookup AND save rechecks the learner and the server's reading deadline.
 * Recall/terminal responses must not become a second route to the hidden source. */
export async function retentionVocabularyAccess(userId: string, attemptId: string, executor = db, now = new Date()) {
  const attempt = await executor.query.retentionAttempts.findFirst({where:and(eq(retentionAttempts.id,attemptId),eq(retentionAttempts.userId,userId))});
  if (!attempt?.retentionTextVersionId) return null;
  return {attempt, locked:resolvePhase(attempt,now).phase !== "reading"};
}

export async function retentionOccurrenceSpans(executor: typeof db, versionId: string) {
  const rows = await executor.select({id:lexicalOccurrences.id,startChar:lexicalOccurrences.startChar,endChar:lexicalOccurrences.endChar,surfaceForm:lexicalOccurrences.surfaceForm})
    .from(lexicalOccurrences).where(and(eq(lexicalOccurrences.sourceType,"retention"),eq(lexicalOccurrences.retentionTextVersionId,versionId)));
  return rows;
}

export async function resolveRetentionOccurrence(user: {id:string}, attemptId:string, occurrenceId:string, executor = db, now = new Date()): Promise<OccurrenceResolution|null> {
  const access = await retentionVocabularyAccess(user.id,attemptId,executor,now);
  if (!access) return null;
  if (access.locked) return {status:"locked",lexeme:null,snapshot:null};
  const versionId=access.attempt.retentionTextVersionId!;
  const [version,occurrence] = await Promise.all([
    executor.query.retentionTextVersions.findFirst({where:eq(retentionTextVersions.id,versionId)}),
    executor.query.lexicalOccurrences.findFirst({where:and(eq(lexicalOccurrences.id,occurrenceId),eq(lexicalOccurrences.sourceType,"retention"),eq(lexicalOccurrences.retentionTextVersionId,versionId))}),
  ]);
  if (!version || !occurrence || !occurrenceSpans(version.bodyText,version.bodyText,[occurrence]).length) return null;
  const snapshot = {occurrenceId:occurrence.id,sourceType:"retention" as const,retentionAttemptId:attemptId,
    sourceTitle:`Retention ${access.attempt.retentionLabelSnapshot ?? access.attempt.level}`,surfaceForm:occurrence.surfaceForm,
    sentenceText:sentenceAt(version.bodyText,occurrence.startChar,occurrence.endChar)};
  const lexeme=occurrence.resolutionStatus === "resolved" && occurrence.lexemeId ? await executor.query.lexemes.findFirst({where:eq(lexemes.id,occurrence.lexemeId)}) : null;
  return lexeme ? {status:"resolved",lexeme,snapshot:{...snapshot,lexemeId:lexeme.id}} : {status:"unresolved",lexeme:null,snapshot:{...snapshot,lexemeId:null}};
}
