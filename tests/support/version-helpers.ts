import { and, desc, eq, type SQL } from "drizzle-orm";
import { contentVersions } from "../../src/db/schema";
import type { db as appDatabase } from "../../src/db/client";

/**
 * Test-side helpers over the REAL version store. They wrap the same columns the
 * services read — they do not reimplement hashing, pinning or publication.
 */
type Reader = { select: typeof appDatabase.select };

export async function versionContent(versionId: string, executor: Reader): Promise<unknown | null> {
  const rows = await executor.select({ contentSnapshot: contentVersions.contentSnapshot }).from(contentVersions).where(eq(contentVersions.id, versionId)).limit(1);
  return rows[0]?.contentSnapshot ?? null;
}

export async function versionsForContent(
  module: string,
  contentType: string,
  sourceRef: string,
  executor: Reader,
): Promise<{ id: string; versionNo: number; status: string }[]> {
  const where: SQL | undefined = and(
    eq(contentVersions.module, module),
    eq(contentVersions.contentType, contentType),
    eq(contentVersions.sourceRef, sourceRef),
  );
  const rows = await executor
    .select({ id: contentVersions.id, versionNo: contentVersions.versionNo, status: contentVersions.status })
    .from(contentVersions)
    .where(where)
    .orderBy(desc(contentVersions.versionNo));
  return rows;
}
