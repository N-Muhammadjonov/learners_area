import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingAiSessionItems, speakingAiSessions, speakingPrompts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/validation/ids";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const session = await db.query.speakingAiSessions.findFirst({ where: and(eq(speakingAiSessions.id, id), eq(speakingAiSessions.userId, user.id)) });
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const items = await db.select().from(speakingAiSessionItems).where(eq(speakingAiSessionItems.sessionId, id)).orderBy(speakingAiSessionItems.ordinal);
  const ids = items.map((item) => item.promptId);
  const prompts = ids.length ? await db.query.speakingPrompts.findMany({ where: inArray(speakingPrompts.id, ids) }) : [];
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  return NextResponse.json({ ok: true, session, items: items.map((item) => ({ ...item, prompt: byId.get(item.promptId) ?? null })) });
}
