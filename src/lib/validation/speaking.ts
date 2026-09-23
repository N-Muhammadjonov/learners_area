import { z } from "zod";

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), textContent: z.string().min(1).max(4000) }),
  z.object({ type: z.literal("link"), linkUrl: z.string().url() }),
  z.object({
    type: z.enum(["file", "image", "audio"]),
    objectUrl: z.string().url(),
    objectKey: z.string().min(1),
    originalName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(120),
    size: z.number().int().positive(),
  }),
]);

export const createMaterialSchema = z.object({
  category: z.enum(["part1", "part2", "part3", "general", "shadowing", "top_structures"]),
  title: z.string().min(3).max(200),
  primaryType: z.enum(["video", "audio", "file", "link"]),
  primaryUrl: z.string().url(),
  primaryObjectKey: z.string().optional(),
  primaryOriginalName: z.string().max(255).optional(),
  primaryMimeType: z.string().max(120).optional(),
  primarySize: z.number().int().positive().optional(),
  blocks: z.array(blockSchema).max(50).default([]),
});

export const updateMaterialSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  isActive: z.boolean().optional(),
  blocks: z.array(blockSchema).max(50).optional(),
});

export type BlockInput = z.infer<typeof blockSchema>;
