import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions, generalReadingSets, generalReadingPassages, listeningTests, readingPassages, speakingMaterials,
  speakingPrompts, videoLessons, writingLessons, writingPrompts, writingTranslationSets,
  writingModelTexts, writingLanguagePatterns } from "@/db/schema";
import { canManageContent, type Actor } from "@/lib/auth/ownership";
import { isStaff } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/data/audit";
import { notDeleted } from "./deletion-filter";

const tables = { reading: readingPassages, "reading-set": generalReadingSets, listening: listeningTests, writing: writingPrompts,
  speaking: speakingMaterials, "speaking-prompt": speakingPrompts, video: videoLessons,
  "writing-lesson": writingLessons, "writing-translation": writingTranslationSets,
  "writing-model-text": writingModelTexts, "writing-pattern": writingLanguagePatterns };
export type DeletableMaterial = keyof typeof tables;
export const canDeleteMaterialType = (type: string): type is DeletableMaterial => Object.hasOwn(tables, type);
type Executor = Pick<typeof db, "select" | "update" | "insert" | "execute">;

/** Atomically remove from all catalogues while retaining immutable result
 * dependencies. Never cascade/delete attempts, evaluations, answers or vocabulary. */
export async function deleteMaterialIn(tx: Executor, actor: Actor, type: DeletableMaterial, id: string) {
  const actorId=actor.id??actor.sub;
  if (!actorId || !isStaff(actor.role)) return "forbidden" as const;
  const table = tables[type];
  const [row] = await tx.select().from(table).where(eq(table.id, id)).for("update");
  if (!row) return "not_found" as const;
  const creator = "createdByUserId" in row ? row.createdByUserId : null;
  if (typeof creator === "string" && !canManageContent(actor, creator)) return "forbidden" as const;
  if (type === "reading-set") {
    const members=await tx.select({id:generalReadingPassages.passageId}).from(generalReadingPassages)
      .where(eq(generalReadingPassages.setId,id)).orderBy(generalReadingPassages.passageId);
    for (const member of members) await deleteMaterialIn(tx,actor,"reading",member.id);
  }
  // This tombstone is not a learning event and never changes learner activity.
  await tx.execute(sql`insert into activity_events(id,user_id,type,payload)
    values(md5('deleted-content:' || ${id})::uuid,${actorId}::uuid,'CONTENT_DELETED',
      ${JSON.stringify({ contentType: type, contentId: id, resultsPreserved: true })}::jsonb)
    on conflict(id) do nothing`);
  await tx.update(table).set({ publicationState: "draft", publishAt: null,
    ...("isActive" in table ? { isActive: false } : {}) }).where(eq(table.id, id));
  // Revisions cannot republish a deleted target or keep it in the content bank.
  const versions = await tx.select({ id: contentVersions.id }).from(contentVersions).where(eq(contentVersions.targetId, id));
  if (versions.length) {
    await tx.update(contentVersions).set({ publicationState: "draft" })
      .where(inArray(contentVersions.id, versions.map(v => v.id)));
    for (const version of versions) await tx.execute(sql`insert into activity_events(id,user_id,type,payload)
      values(md5('deleted-content:' || ${version.id})::uuid,${actorId}::uuid,'CONTENT_DELETED',
        ${JSON.stringify({ contentType: "content-version", contentId: version.id, resultsPreserved: true })}::jsonb)
      on conflict(id) do nothing`);
  }
  await recordAudit({ actorUserId: actorId, action: "content.updated", targetType: type,
    targetId: id, metadata: { operation: "delete", resultsPreserved: true } }, tx);
  return "deleted" as const;
}
export async function deleteMaterial(actor: Actor, type: DeletableMaterial, id: string) {
  return db.transaction(tx => deleteMaterialIn(tx, actor, type, id));
}
export async function materialDeleted(id: string, executor: Pick<typeof db, "execute"> = db) {
  const result = await executor.execute(sql`select not (${notDeleted(sql`${id}::uuid`)}) as deleted`);
  return result.rows[0]?.deleted === true;
}
