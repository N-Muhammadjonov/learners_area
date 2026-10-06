import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions, grammarTopics, listeningPackages, readingPassages } from "@/db/schema";
import { publishedVersion, type VersionReader, type VersionRecord } from "@/lib/content/versions";

/**
 * ATTEMPT → REVISION BINDING (§71, §72).
 *
 * The version store can describe exactly what a learner was given, but that only
 * protects history if the attempt RECORDS it. These functions answer one question,
 * in one place: for this content row, which revision is the one a learner starting
 * now would be given?
 *
 * The answers are deliberately conservative:
 *   - only a PUBLISHED revision is ever returned (an attempt is never bound to a
 *     draft nobody may open);
 *   - when there is no revision — content that predates the version store, or a
 *     legacy row — the answer is `null`, and the attempt is recorded WITH a null
 *     binding rather than a guessed one. A guess here would be worse than an
 *     absence: it would claim history that never happened.
 */

function toVersion(row: typeof contentVersions.$inferSelect): VersionRecord {
  return {
    id: row.id,
    module: row.module,
    contentType: row.contentType,
    sourceRef: row.sourceRef,
    versionNo: row.versionNo,
    status: row.status,
    title: row.title,
    track: row.track,
    contentHash: row.contentHash,
    semanticHash: row.semanticHash,
    answerKeyHash: row.answerKeyHash,
    publicationState: row.publicationState,
    targetType: row.targetType,
    targetId: row.targetId,
  };
}

/** The newest published revision that describes a specific content row. */
export async function publishedVersionForTarget(
  targetType: string,
  targetId: string,
  executor: VersionReader = db,
): Promise<VersionRecord | null> {
  const rows = await executor
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.targetType, targetType), eq(contentVersions.targetId, targetId), eq(contentVersions.status, "published")))
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  return rows[0] ? toVersion(rows[0]) : null;
}

/** The revision a learner starting this Listening test is given. */
export async function revisionForListeningTest(testId: string, executor: VersionReader = db): Promise<VersionRecord | null> {
  const direct = await publishedVersionForTarget("listening_test", testId, executor);
  if (direct) return direct;
  // Content imported before the importer pinned revisions: the package's own source
  // id still identifies the item, so the published revision can be found by identity.
  const [row] = await executor
    .select({ sourceId: listeningPackages.sourceId })
    .from(listeningPackages)
    .where(eq(listeningPackages.testId, testId))
    .limit(1);
  return row?.sourceId ? publishedVersion("listening", "full_test", row.sourceId, executor) : null;
}

/** The revision a learner starting this Reading passage is given. */
export async function revisionForReadingPassage(passageId: string, executor: VersionReader = db): Promise<VersionRecord | null> {
  const direct = await publishedVersionForTarget("reading_passage", passageId, executor);
  if (direct) return direct;
  // A passage belongs to a set; the set's source ref is the identity the import
  // pinned, and the passage carries the same ref.
  const [row] = await executor
    .select({ sourceRef: readingPassages.sourceRef })
    .from(readingPassages)
    .where(eq(readingPassages.id, passageId))
    .limit(1);
  if (!row?.sourceRef) return null;
  return (
    (await publishedVersion("reading", "general_set", row.sourceRef, executor)) ??
    (await publishedVersion("reading", "passage", row.sourceRef, executor))
  );
}

/** The revision a learner answering this Grammar topic is given. */
export async function revisionForGrammarTopic(topicId: string, executor: VersionReader = db): Promise<VersionRecord | null> {
  const direct = await publishedVersionForTarget("grammar_topic", topicId, executor);
  if (direct) return direct;
  const [row] = await executor
    .select({ sourceRef: grammarTopics.sourceRef })
    .from(grammarTopics)
    .where(eq(grammarTopics.id, topicId))
    .limit(1);
  return row?.sourceRef ? publishedVersion("grammar", "topic", row.sourceRef, executor) : null;
}

/** The revision a learner answering this Writing prompt is given. */
export async function revisionForWritingPrompt(promptId: string, executor: VersionReader = db): Promise<VersionRecord | null> {
  return publishedVersionForTarget("writing_prompt", promptId, executor);
}
