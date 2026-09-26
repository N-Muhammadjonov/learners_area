import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningAttempts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getStartableTest } from "@/lib/data/listening";

const schema = z.object({ testId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const test = await getStartableTest(parsed.data.testId);
  if (!test) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const existing = await db.query.listeningAttempts.findFirst({
    where: and(
      eq(listeningAttempts.userId, user.id),
      eq(listeningAttempts.testId, parsed.data.testId),
      eq(listeningAttempts.status, "in_progress")
    ),
  });
  if (existing) return NextResponse.json({ id: existing.id });

  const [created] = await db
    .insert(listeningAttempts)
    .values({ userId: user.id, testId: parsed.data.testId })
    .returning();

  return NextResponse.json({ id: created!.id });
}
