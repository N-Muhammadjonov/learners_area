import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { writingPrompts, writingSubmissions } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { createSubmissionSchema } from "@/lib/validation/writing";
import { isLive } from "@/lib/services/cms/publication";
import { revisionForWritingPrompt } from "@/lib/content/attempt-binding";

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // A prompt that is not live cannot be started; the refusal looks exactly like
  // an unknown prompt id.
  const prompt = await db.query.writingPrompts.findFirst({
    where: eq(writingPrompts.id, parsed.data.promptId),
  });
  if (!prompt || !isLive(prompt)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const existingDraft = await db.query.writingSubmissions.findFirst({
    where: and(
      eq(writingSubmissions.userId, user.id),
      eq(writingSubmissions.promptId, parsed.data.promptId),
      eq(writingSubmissions.status, "draft")
    ),
  });
  if (existingDraft) {
    return NextResponse.json({ id: existingDraft.id });
  }

  // The submission records the task revision it answers, so a later edit to the
  // prompt (or its guidance) cannot change what this learner is judged against (§71).
  const revision = await revisionForWritingPrompt(parsed.data.promptId);
  const [created] = await db
    .insert(writingSubmissions)
    .values({
      userId: user.id,
      promptId: parsed.data.promptId,
      ...(revision ? { contentVersionId: revision.id } : {}),
    })
    .returning();

  return NextResponse.json({ id: created!.id });
}
