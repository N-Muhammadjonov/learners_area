import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { writingSubmissions } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { createSubmissionSchema } from "@/lib/validation/writing";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const existingDraft = await db.query.writingSubmissions.findFirst({
    where: and(
      eq(writingSubmissions.userId, session.sub),
      eq(writingSubmissions.promptId, parsed.data.promptId),
      eq(writingSubmissions.status, "draft")
    ),
  });
  if (existingDraft) {
    return NextResponse.json({ id: existingDraft.id });
  }

  const [created] = await db
    .insert(writingSubmissions)
    .values({ userId: session.sub, promptId: parsed.data.promptId })
    .returning();

  return NextResponse.json({ id: created!.id });
}
