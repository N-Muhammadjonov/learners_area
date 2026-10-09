import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";
import { readSpeakingAiSession } from "@/lib/data/speaking-ai-sessions";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const result = await readSpeakingAiSession(db, user.id, id);
  return result ? NextResponse.json({ ok: true, ...result }) : NextResponse.json({ error: "not_found" }, { status: 404 });
}
