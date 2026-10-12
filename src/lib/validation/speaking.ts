import { z } from "zod";
import { resourceHref } from "./uploads";

/**
 * Speaking/resource content validation.
 *
 * Attachment blocks are sent as a *reference* — either the id of an upload
 * intent the server issued for this user, or the objectKey of a block already
 * stored on this same material (retained across an edit). The filename, mime
 * type and size are NOT accepted from the client: they come from the intent
 * row, which the server wrote after its own validation. See
 * src/lib/data/uploads.ts#claimAttachment.
 *
 * Stored `objectUrl` is always the stable, non-expiring
 * `/api/resources/<objectKey>` path — never a signed URL, which would go
 * stale and must not become the authoritative reference.
 */

const attachmentRefSchema = z
  .object({
    uploadId: z.string().uuid().nullish(),
    objectKey: z.string().min(1).max(400).nullish(),
  })
  .refine((v) => Boolean(v.uploadId || v.objectKey), {
    message: "missing_attachment",
    path: ["uploadId"],
  });

/** A description block. Text and link carry their own data; media carry a ref. */
export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), textContent: z.string().min(1).max(4000) }),
  z.object({ type: z.literal("link"), linkUrl: z.string().url().max(2000) }),
  z.object({ type: z.literal("image"), ref: attachmentRefSchema }),
  z.object({ type: z.literal("audio"), ref: attachmentRefSchema }),
  z.object({ type: z.literal("file"), ref: attachmentRefSchema }),
]);

export type BlockInput = z.infer<typeof blockSchema>;
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

/** The resource's main file: either an uploaded object or an external link. */
export const primarySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("upload"),
    primaryType: z.enum(["video", "audio", "file"]),
    ref: attachmentRefSchema,
  }),
  z.object({
    mode: z.literal("link"),
    primaryType: z.literal("link"),
    primaryUrl: z.string().url().max(2000),
  }),
]);

export const createMaterialSchema = z.object({
  // "shadowing" is deliberately absent: the feature is retired, so no NEW material may
  // be authored into that category. The enum value survives in the database so
  // historical rows keep their category and are preserved.
  category: z.enum(["part1", "part2", "part3", "general", "top_structures"]),
  title: z.string().min(3).max(200),
  primary: primarySchema,
  blocks: z.array(blockSchema).max(50).default([]),
});

export const updateMaterialSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  isActive: z.boolean().optional(),
  /** Replaces the whole ordered block list; blocks are matched by reference. */
  blocks: z.array(blockSchema).max(50).optional(),
  /** Replaces the primary file/link. Omit to leave it untouched. */
  primary: primarySchema.optional(),
});

export { resourceHref };
