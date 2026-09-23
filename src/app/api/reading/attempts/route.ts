import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

const schema = z.object({ passageId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const existing = await db.query.readingAttempts.findFirst({
    where: and(
      eq(readingAttempts.userId, session.sub),
      eq(readingAttempts.passageId, parsed.data.passageId),
      eq(readingAttempts.status, "in_progress")
    ),
  });
  if (existing) return NextResponse.json({ id: existing.id });

  const [created] = await db
    .insert(readingAttempts)
    .values({ userId: session.sub, passageId: parsed.data.passageId })
    .returning();

  return NextResponse.json({ id: created!.id });
}
