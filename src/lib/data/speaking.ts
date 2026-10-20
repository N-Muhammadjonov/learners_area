import { notDeleted } from "@/lib/content/deletion-filter";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { timed } from "@/lib/observability/timing";
import { speakingMaterials, materialBlocks, users } from "@/db/schema";
import { isLive, liveWhere } from "@/lib/services/cms/publication";

async function withBlocks<T extends { material: typeof speakingMaterials.$inferSelect }>(
  rows: T[]
): Promise<(T & { blocks: (typeof materialBlocks.$inferSelect)[]; blocksUnavailable: boolean })[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.material.id);
  let allBlocks: (typeof materialBlocks.$inferSelect)[];
  try {
    allBlocks = await timed("speaking.materialBlocks", () => db.query.materialBlocks.findMany({
      where: inArray(materialBlocks.materialId, ids),
      orderBy: asc(materialBlocks.position),
    }));
  } catch {
    // The published materials remain useful without optional attached blocks.
    // Expose the failure so the page can render a local alert and retry action.
    return rows.map((r) => ({ ...r, blocks: [], blocksUnavailable: true }));
  }

  const byMaterial = new Map<string, (typeof materialBlocks.$inferSelect)[]>();
  for (const block of allBlocks) {
    const list = byMaterial.get(block.materialId) ?? [];
    list.push(block);
    byMaterial.set(block.materialId, list);
  }
  return rows.map((r) => ({
    ...r,
    blocks: byMaterial.get(r.material.id) ?? [],
    blocksUnavailable: false,
  }));
}

async function listLiveMaterialRows() {
  return timed("speaking.materials", () => db
    .select({ material: speakingMaterials, authorName: users.name })
    .from(speakingMaterials)
    .innerJoin(users, eq(speakingMaterials.createdByUserId, users.id))
    .where(
      liveWhere({
        publicationState: speakingMaterials.publicationState,
        publishAt: speakingMaterials.publishAt,
      }),
    )
    .orderBy(asc(speakingMaterials.category), desc(speakingMaterials.createdAt)));
}

/** Start the optional block read as soon as the material ids are known, but let the entry page stream cards before it resolves. */
export async function listActiveMaterialsForEntry() {
  const rows = await listLiveMaterialRows();
  return { rows, blocksPromise: withBlocks(rows) };
}

export async function listActiveMaterials() {
  const { blocksPromise } = await listActiveMaterialsForEntry();
  return blocksPromise;
}

export async function listAllForManagement() {
  const rows = await db
    .select({ material: speakingMaterials, authorName: users.name })
    .from(speakingMaterials)
    .innerJoin(users, eq(speakingMaterials.createdByUserId, users.id))
    .where(notDeleted(speakingMaterials.id)).orderBy(desc(speakingMaterials.createdAt));
  return withBlocks(rows);
}

export async function getMaterialWithBlocks(id: string) {
  const material = await db.query.speakingMaterials.findFirst({ where: and(eq(speakingMaterials.id, id),notDeleted(speakingMaterials.id)) });
  if (!material) return null;
  const blocks = await db.query.materialBlocks.findMany({
    where: eq(materialBlocks.materialId, id),
    orderBy: asc(materialBlocks.position),
  });
  return { material, blocks };
}
