import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingMaterials, materialBlocks, users } from "@/db/schema";

async function withBlocks<T extends { material: typeof speakingMaterials.$inferSelect }>(
  rows: T[]
): Promise<(T & { blocks: (typeof materialBlocks.$inferSelect)[] })[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.material.id);
  const allBlocks = await db.query.materialBlocks.findMany({
    orderBy: asc(materialBlocks.position),
  });
  const byMaterial = new Map<string, (typeof materialBlocks.$inferSelect)[]>();
  for (const b of allBlocks) {
    if (!ids.includes(b.materialId)) continue;
    const list = byMaterial.get(b.materialId) ?? [];
    list.push(b);
    byMaterial.set(b.materialId, list);
  }
  return rows.map((r) => ({ ...r, blocks: byMaterial.get(r.material.id) ?? [] }));
}

export async function listActiveMaterials() {
  const rows = await db
    .select({ material: speakingMaterials, authorName: users.name })
    .from(speakingMaterials)
    .innerJoin(users, eq(speakingMaterials.createdByUserId, users.id))
    .where(eq(speakingMaterials.isActive, true))
    .orderBy(asc(speakingMaterials.category), desc(speakingMaterials.createdAt));
  return withBlocks(rows);
}

export async function listAllForManagement() {
  const rows = await db
    .select({ material: speakingMaterials, authorName: users.name })
    .from(speakingMaterials)
    .innerJoin(users, eq(speakingMaterials.createdByUserId, users.id))
    .orderBy(desc(speakingMaterials.createdAt));
  return withBlocks(rows);
}

export async function getMaterialWithBlocks(id: string) {
  const material = await db.query.speakingMaterials.findFirst({ where: eq(speakingMaterials.id, id) });
  if (!material) return null;
  const blocks = await db.query.materialBlocks.findMany({
    where: eq(materialBlocks.materialId, id),
    orderBy: asc(materialBlocks.position),
  });
  return { material, blocks };
}
