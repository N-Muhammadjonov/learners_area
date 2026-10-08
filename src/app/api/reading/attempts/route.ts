import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts, readingPassages } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getStartablePassage } from "@/lib/data/reading";
import { revisionForReadingPassage } from "@/lib/content/attempt-binding";

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
  const outcome = await db.transaction(async tx => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id + ":" + parsed.data.passageId}))`);
  await tx.select({id:readingPassages.id}).from(readingPassages).where(eq(readingPassages.id,parsed.data.passageId)).for("share");
  const passage = await getStartablePassage(parsed.data.passageId);
  if (!passage) return null;

  const existing = await tx.query.readingAttempts.findFirst({
    where: and(
      eq(readingAttempts.userId, user.id),
      eq(readingAttempts.passageId, parsed.data.passageId),
      eq(readingAttempts.status, "in_progress")
    ),
  });
  if (existing) return existing.id;

  // The attempt records the revision the learner was given, so an edit to the
  // passage later cannot change what this attempt is graded and reviewed against
  // (§71). No revision (legacy content) means a null binding, never a guess.
  const revision = await revisionForReadingPassage(parsed.data.passageId,tx);
  const [created] = await tx
    .insert(readingAttempts)
    .values({
      userId: user.id,
      passageId: parsed.data.passageId,
      ...(revision ? { contentVersionId: revision.id } : {}),
    })
    .returning();

  return created!.id;
  });
  if(!outcome) return NextResponse.json({error:"not_found"},{status:404});
  return NextResponse.json({ id: outcome });
}
