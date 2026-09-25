import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { createFolder, listFolders, moveToFolder } from "@/lib/services/vocabulary/engine";

/**
 * GET  /api/vocabulary/folders — the caller's own folders
 * POST /api/vocabulary/folders — create one, or move words into one
 */
const createSchema = z.object({ name: z.string().trim().min(1).max(80) });
const moveSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(200),
  folderId: z.string().uuid().nullable(),
});

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ ok: true, folders: await listFolders(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);

  const move = moveSchema.safeParse(body);
  if (move.success) {
    const result = await moveToFolder(user.id, move.data.entryIds, move.data.folderId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ ok: true, moved: result.moved });
  }

  const create = createSchema.safeParse(body);
  if (!create.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await createFolder(user.id, create.data.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({
    ok: true,
    folder: result.folder,
    // True when the folder already existed: the interface says so instead of
    // pretending a second folder was created.
    existing: result.existing ?? false,
  });
}
