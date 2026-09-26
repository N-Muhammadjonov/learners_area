import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getStartablePassage } from "@/lib/data/reading";

const schema = z.object({ passageId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // A passage that is a draft, not yet due, or archived is not startable — and
  // the answer is the same 404 as a passage that does not exist, so a withdrawn
  // name cannot be probed for. An attempt that already exists stays readable.
  const passage = await getStartablePassage(parsed.data.passageId);
  if (!passage) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const existing = await db.query.readingAttempts.findFirst({
    where: and(
      eq(readingAttempts.userId, user.id),
      eq(readingAttempts.passageId, parsed.data.passageId),
      eq(readingAttempts.status, "in_progress")
    ),
  });
  if (existing) return NextResponse.json({ id: existing.id });

  const [created] = await db
    .insert(readingAttempts)
    .values({ userId: user.id, passageId: parsed.data.passageId })
    .returning();

  return NextResponse.json({ id: created!.id });
}
