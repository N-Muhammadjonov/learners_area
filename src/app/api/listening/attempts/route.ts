import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningAttempts } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

const schema = z.object({ testId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const existing = await db.query.listeningAttempts.findFirst({
    where: and(
      eq(listeningAttempts.userId, session.sub),
      eq(listeningAttempts.testId, parsed.data.testId),
      eq(listeningAttempts.status, "in_progress")
    ),
  });
  if (existing) return NextResponse.json({ id: existing.id });

  const [created] = await db
    .insert(listeningAttempts)
    .values({ userId: session.sub, testId: parsed.data.testId })
    .returning();

  return NextResponse.json({ id: created!.id });
}
