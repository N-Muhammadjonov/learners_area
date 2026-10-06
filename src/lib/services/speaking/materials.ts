import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentVersions, materialBlocks, speakingMaterials } from "@/db/schema";
import { pinVersion } from "@/lib/content/versions";
import type { ImportTransaction } from "@/lib/import/core/dry-run";

/**
 * SPEAKING MATERIALS: CANONICAL IDENTITY (§6).
 *
 * `speaking_materials` is a real store with real learner surfaces — the Practice hub,
 * Speaking lessons, the shadowing studio — but it had no canonical identity: no
 * `source_ref`, no revision, nothing the bank or a pinned reference could name. That is
 * how a table becomes a parallel content store by accident.
 *
 * This module gives it the SAME identity the other content kinds have, without moving
 * anything and without a schema change: the item's identity is the `content_versions`
 * row (`module: speaking`, `contentType: material`, `targetType: speaking_material`,
 * `targetId` = the material row). The material table stays exactly where it is and
 * keeps serving the learner pages it already serves.
 *
 * Two things are deliberately NOT done here:
 *
 *   • the version snapshot never contains an object key. Files live in private storage
 *     and reach a material only through upload-intent → upload → finalize → claim; a
 *     revision records that a primary exists and what it is, not how to fetch it.
 *   • `shadowing` is not a separate store. It is a material CATEGORY (a row whose
 *     `category` is `shadowing`) that the studio reads; shadowing takes are
 *     local-only by design, so there is no shadowing attempt to bind.
 */

export const SPEAKING_MATERIAL_TARGET_TYPE = "speaking_material";

/** The canonical content of a material: descriptive, verifiable, key-free. */
export type SpeakingMaterialSnapshot = {
  title: string;
  category: string;
  primaryType: string;
  /** Only a link primary has a URL that belongs in a snapshot; uploads are private objects. */
  primaryUrl: string | null;
  hasPrimary: boolean;
  primaryOriginalName: string | null;
  primaryMimeType: string | null;
  primarySize: number | null;
  blocks: { type: string; text?: string; link?: string }[];
};

export function speakingMaterialSnapshot(
  material: {
    title: string;
    category: string;
    primaryType: string;
    primaryUrl: string | null;
    primaryObjectKey?: string | null;
    primaryOriginalName?: string | null;
    primaryMimeType?: string | null;
    primarySize?: number | null;
  },
  blocks: { type: string; textContent: string | null; linkUrl: string | null }[] = [],
): SpeakingMaterialSnapshot {
  return {
    title: material.title,
    category: material.category,
    primaryType: material.primaryType,
    primaryUrl: material.primaryType === "link" ? material.primaryUrl : null,
    hasPrimary: Boolean(material.primaryUrl),
    // The file's own facts, never the storage key: a re-upload of a different file is a
    // new revision, and re-uploading the same bytes is not.
    primaryOriginalName: material.primaryOriginalName ?? null,
    primaryMimeType: material.primaryMimeType ?? null,
    primarySize: material.primarySize ?? null,
    // Text and links are content; an attachment is represented by its type alone.
    blocks: blocks.map((block) => ({
      type: block.type,
      ...(block.textContent ? { text: block.textContent } : {}),
      ...(block.linkUrl ? { link: block.linkUrl } : {}),
    })),
  };
}

/**
 * The identity a material is already known by, read from its own latest revision.
 *
 * A material that has no revision yet has no identity — the caller decides one and
 * pins it. Nothing is derived from the title.
 */
export async function sourceRefForSpeakingMaterial(
  materialId: string,
  executor: { select: typeof db.select } = db,
): Promise<string | null> {
  const [row] = await executor
    .select({ sourceRef: contentVersions.sourceRef })
    .from(contentVersions)
    .where(eq(contentVersions.targetId, materialId))
    .orderBy(desc(contentVersions.versionNo))
    .limit(1);
  return row?.sourceRef ?? null;
}

export type PinSpeakingMaterialInput = {
  materialId: string;
  sourceRef: string;
  title: string;
  category: string;
  primaryType: string;
  primaryUrl: string | null;
  primaryObjectKey?: string | null;
  primaryOriginalName?: string | null;
  primaryMimeType?: string | null;
  primarySize?: number | null;
  track?: string;
  publicationState: string;
  actorUserId: string | null;
  /** How this write happened — an authored draft or the verified upload route. */
  via: "authoring" | "upload_route" | "legacy";
};

/** Write the canonical revision for a material. The ONLY writer of material versions. */
export async function pinSpeakingMaterialVersion(tx: ImportTransaction, input: PinSpeakingMaterialInput) {
  const blocks = await tx
    .select({ type: materialBlocks.type, textContent: materialBlocks.textContent, linkUrl: materialBlocks.linkUrl })
    .from(materialBlocks)
    .where(eq(materialBlocks.materialId, input.materialId))
    .orderBy(materialBlocks.position);

  return pinVersion(tx, {
    module: "speaking",
    contentType: "material",
    sourceRef: input.sourceRef,
    title: input.title,
    track: input.track ?? "unspecified",
    content: speakingMaterialSnapshot(
      {
        title: input.title,
        category: input.category,
        primaryType: input.primaryType,
        primaryUrl: input.primaryUrl,
        primaryObjectKey: input.primaryObjectKey ?? null,
        primaryOriginalName: input.primaryOriginalName ?? null,
        primaryMimeType: input.primaryMimeType ?? null,
        primarySize: input.primarySize ?? null,
      },
      blocks,
    ),
    publicationState: input.publicationState,
    actorUserId: input.actorUserId,
    targetType: SPEAKING_MATERIAL_TARGET_TYPE,
    targetId: input.materialId,
    provenance: { via: input.via, store: "speaking_materials" },
  });
}

/** The material a revision names, when it names one. */
export async function speakingMaterialIdForVersion(
  version: { targetType: string | null; targetId: string | null },
  executor: { select: typeof db.select } = db,
): Promise<string | null> {
  if (version.targetType !== SPEAKING_MATERIAL_TARGET_TYPE || !version.targetId) return null;
  const [row] = await executor.select({ id: speakingMaterials.id }).from(speakingMaterials).where(eq(speakingMaterials.id, version.targetId)).limit(1);
  return row?.id ?? null;
}
