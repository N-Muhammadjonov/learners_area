import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { writingSubmissions } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { saveDraftSchema } from "@/lib/validation/writing";
import { countWords } from "@/lib/services/writing-evaluation/heuristics";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = saveDraftSchema.safeParse({ ...body, submissionId: id });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const wordCount = countWords(parsed.data.content);

  const [updated] = await db
    .update(writingSubmissions)
    .set({ content: parsed.data.content, wordCount, updatedAt: new Date() })
    .where(
      and(
        eq(writingSubmissions.id, parsed.data.submissionId),
        eq(writingSubmissions.userId, user.id),
        eq(writingSubmissions.status, "draft")
      )
    )
    .returning({ id: writingSubmissions.id, wordCount: writingSubmissions.wordCount });

  if (!updated) {
    return NextResponse.json({ error: "not_found_or_locked" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, wordCount: updated.wordCount });
}
