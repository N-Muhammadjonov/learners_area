import { deleteMaterial } from "@/lib/content/delete-material";
import { actorOf } from "@/lib/auth/current-user";
import { checkRequestOrigin } from "@/lib/http/request-origin";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdministrator } from "@/lib/auth/current-user";
import { db } from "@/db/client";
import { listeningTests } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
const titleSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
async function update(req: NextRequest, params: Promise<{ id: string }>, archive: boolean) {
  const user = await requireAdministrator();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = archive ? null : titleSchema.safeParse(await req.json().catch(() => null));
  if (!archive && !parsed?.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const updated = await db.transaction(async tx => {
    const [current] = await tx.select().from(listeningTests).where(eq(listeningTests.id, id)).for("update");
    if (!current) return false;
    await tx.update(listeningTests).set(archive ? { publicationState: "archived", isActive: false, publishAt: null } : { title: parsed!.success ? parsed!.data.title : current.title }).where(eq(listeningTests.id, id));
    await recordAudit({ actorUserId: user.id, action: "content.updated", targetType: "listening", targetId: id, metadata: { operation: archive ? "archive" : "rename" } }, tx);
    return true;
  });
  return NextResponse.json(updated ? { ok: true } : { error: "not_found" }, { status: updated ? 200 : 404, headers: { "Cache-Control": "private, no-store" } });
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) { return update(req, params, false); }
export async function DELETE(req: NextRequest, {params}: {params:Promise<{id:string}>}) {
  if (!checkRequestOrigin(req).allowed) return NextResponse.json({error:"invalid_origin"},{status:403});
  const admin=await requireAdministrator();if(!admin)return NextResponse.json({error:"forbidden"},{status:403});
  const {id}=await params;if(!z.string().uuid().safeParse(id).success)return NextResponse.json({error:"not_found"},{status:404});
  const action=await deleteMaterial(actorOf(admin),"listening",id);
  return NextResponse.json(action==="deleted"?{ok:true,action,resultsPreserved:true}:{error:action},{status:action==="not_found"?404:action==="forbidden"?403:200});
}
