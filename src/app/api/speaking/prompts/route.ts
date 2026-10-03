import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { speakingPrompts } from "@/db/schema";
import { requireAdministrator, requireActiveUser } from "@/lib/auth/current-user";
import { liveWhere } from "@/lib/services/cms/publication";

/**
 * GET /api/speaking/prompts — the prompts a student can practise against.
 *
 * Only prompts that are live right now are listed (the publication rule, not the
 * older boolean). Order is by part then insertion, so the practice screen shows
 * a stable, predictable sequence.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const part = req.nextUrl.searchParams.get("part");
  const rows = await db.query.speakingPrompts.findMany({
    where: liveWhere({
      publicationState: speakingPrompts.publicationState,
      publishAt: speakingPrompts.publishAt,
    }),
    orderBy: [asc(speakingPrompts.part), asc(speakingPrompts.createdAt)],
  });

  const filtered = part ? rows.filter((r) => r.part === part) : rows;
  return NextResponse.json({ ok: true, prompts: filtered });
}

/** Owner/admin authoring writes the same bank the learner and partner modules read. */
export async function POST(req: NextRequest) {
  const user = await requireAdministrator();
  if (!user) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { speakingPromptDraft, sharedSpeakingChannels } = await import("@/lib/speaking/study-support");
  const { cleanStudyHtml } = await import("@/lib/speaking/rich-text");
  const parsed = speakingPromptDraft.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const { id, studySupport, ...draft } = parsed.data;
  const values = { ...draft, availableIn: sharedSpeakingChannels(draft.availableIn), category: draft.part, prepSeconds: draft.part === "part2" ? 60 : 0,
    answerSeconds: draft.part === "part2" ? 120 : draft.part === "part3" ? 45 : 30,
    studySupport: { ...studySupport, vocabularyHtml: cleanStudyHtml(studySupport.vocabularyHtml),
      modelAnswerHtml: cleanStudyHtml(studySupport.modelAnswerHtml), ideasHtml: cleanStudyHtml(studySupport.ideasHtml) },
    publicationState: "published" as const };
  const rows = id ? await db.update(speakingPrompts).set(values).where(eq(speakingPrompts.id, id)).returning()
    : await db.insert(speakingPrompts).values(values).returning();
  if (!rows[0]) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, prompt: rows[0] }, { status: id ? 200 : 201 });
}
