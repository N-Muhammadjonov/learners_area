import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingPrompts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isLive } from "@/lib/services/cms/publication";
import { studySupportSchema, usesSharedSpeakingBank } from "@/lib/speaking/study-support";
import { addVocabularyBatch, createFolder, moveToFolder } from "@/lib/services/vocabulary/engine";

const input = z.object({ promptId: z.string().uuid(), indices: z.array(z.number().int().min(0).max(99)).min(1).max(100) });
/** Word meanings are read from the published prompt, never trusted from the learner. */
export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const prompt = await db.query.speakingPrompts.findFirst({ where: eq(speakingPrompts.id, parsed.data.promptId) });
  if (!prompt || !isLive(prompt) || !usesSharedSpeakingBank(prompt.availableIn)) return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  const support = studySupportSchema.safeParse(prompt.studySupport);
  if (!support.success) return NextResponse.json({ error: "invalid_source" }, { status: 409 });
  const items = [...new Set(parsed.data.indices)].map(i => support.data.vocabulary[i]);
  if (items.some(item => !item)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const folder = await createFolder(user.id, prompt.promptText);
  if (!folder.ok) return NextResponse.json({ error: folder.error }, { status: 503 });
  const result = await addVocabularyBatch({ userId: user.id, sourceType: "speaking", sourceId: prompt.id, folderId: folder.folder.id, items: items.filter((item): item is NonNullable<typeof item> => !!item) });
  if (result.ok && result.ids.length) await moveToFolder(user.id, result.ids, folder.folder.id);
  return NextResponse.json({ ...result, folder: folder.folder }, { status: result.ok ? 200 : 404 });
}
