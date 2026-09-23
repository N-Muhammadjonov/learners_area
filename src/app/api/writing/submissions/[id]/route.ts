import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { writingSubmissions } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { saveDraftSchema } from "@/lib/validation/writing";
import { countWords } from "@/lib/services/writing-evaluation/heuristics";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = saveDraftSchema.safeParse({ ...body, submissionId: params.id });
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
        eq(writingSubmissions.userId, session.sub),
        eq(writingSubmissions.status, "draft")
      )
    )
    .returning({ id: writingSubmissions.id, wordCount: writingSubmissions.wordCount });

  if (!updated) {
    return NextResponse.json({ error: "not_found_or_locked" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, wordCount: updated.wordCount });
}
