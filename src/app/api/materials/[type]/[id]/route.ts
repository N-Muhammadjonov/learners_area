import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { listResourceBlocks, saveResourceBlocks } from "@/lib/data/resources";
import {
  isResourceOwnerType,
  loadResourceOwner,
  mayReadResources,
  mayWriteResources,
} from "@/lib/services/resources/owners";
import { RULES, accountKey, blockIfOver, consume } from "@/lib/http/rate-limit";

/**
 * GET  /api/materials/:type/:id  — the material blocks attached to one owner.
 * PUT  /api/materials/:type/:id  — replace them, in the order sent.
 *
 * One endpoint for all eight content kinds, because the rule that governs them is
 * the same: an owner that exists, a caller who may read or write it, and blocks
 * whose files were really uploaded by this user. `:type` is validated against the
 * registry before anything touches the database, so a made-up type is a 404 and
 * never a query against an arbitrary table.
 *
 * The delivery of the files themselves is NOT here: media is served by
 * /api/resources/<objectKey>, which re-authorizes every request. A block only
 * ever stores a private object key — never a URL a client could hand out.
 */

const blockSchema = z
  .object({
    type: z.enum(["text", "link", "file", "image", "audio"]),
    textContent: z.string().max(4000).nullish(),
    linkUrl: z.string().max(2048).nullish(),
    uploadId: z.string().uuid().nullish(),
    objectKey: z.string().max(512).nullish(),
  })
  .strict();

const bodySchema = z.object({ blocks: z.array(blockSchema).max(40) }).strict();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isResourceOwnerType(type) || !isUuid(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const owner = await loadResourceOwner(type, id);
  if (!owner) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!mayReadResources(user.role, owner)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const blocks = await listResourceBlocks(type, id);
  return NextResponse.json({
    ok: true,
    blocks: blocks.map((block) => ({
      id: block.id,
      type: block.type,
      position: block.position,
      textContent: block.textContent,
      linkUrl: block.linkUrl,
      objectKey: block.objectKey,
      originalName: block.originalName,
      mimeType: block.mimeType,
      size: block.size,
    })),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isResourceOwnerType(type) || !isUuid(id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!mayWriteResources(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const owner = await loadResourceOwner(type, id);
  if (!owner) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A listing is a write loop if it is hammered; the same limiter the rest of the
  // app uses keeps one account from filling storage with abandoned objects.
  const rateKey = accountKey(`resources:${user.id}`);
  const limited = blockIfOver(RULES.uploadIntent, rateKey);
  if (limited) return limited;
  consume(RULES.uploadIntent, rateKey);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const saved = await saveResourceBlocks({
    ownerType: type,
    ownerId: id,
    userId: user.id,
    blocks: parsed.data.blocks,
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });

  return NextResponse.json({
    ok: true,
    blocks: saved.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      position: block.position,
      textContent: block.textContent,
      linkUrl: block.linkUrl,
      objectKey: block.objectKey,
      originalName: block.originalName,
      mimeType: block.mimeType,
      size: block.size,
    })),
  });
}
