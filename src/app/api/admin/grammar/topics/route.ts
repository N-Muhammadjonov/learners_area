import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { grammarTopics } from "@/db/schema";
import { isAdministrator, requireActiveUser } from "@/lib/auth/current-user";
import { createGrammarTopicSchema } from "@/lib/validation/admin";

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isAdministrator(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createGrammarTopicSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_input" }, { status: 400 });

  const existing = await db.query.grammarTopics.findMany();
  const [created] = await db
    .insert(grammarTopics)
    .values({ ...parsed.data, order: existing.length + 1 })
    .returning();

  return NextResponse.json({ ok: true, id: created!.id });
}
