import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { lexemes, userVocabulary } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";

const addSchema = z.object({
  term: z.string().trim().min(1).max(120),
  definitionEn: z.string().trim().min(1).max(500),
  translationUz: z.string().trim().max(500).optional(),
  exampleSentence: z.string().trim().max(500).optional(),
  sourceType: z.string().max(40).optional(),
  sourceId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const data = parsed.data;

  let lexeme = await db.query.lexemes.findFirst({ where: eq(lexemes.term, data.term.toLowerCase()) });
  if (!lexeme) {
    const [created] = await db
      .insert(lexemes)
      .values({
        term: data.term.toLowerCase(),
        definitionEn: data.definitionEn,
        translationUz: data.translationUz,
        exampleSentence: data.exampleSentence,
      })
      .returning();
    lexeme = created;
  }
  if (!lexeme) return NextResponse.json({ error: "server_error" }, { status: 500 });

  const existing = await db.query.userVocabulary.findFirst({
    where: and(eq(userVocabulary.userId, user.id), eq(userVocabulary.lexemeId, lexeme.id)),
  });
  if (existing) return NextResponse.json({ ok: true, id: existing.id, alreadyExisted: true });

  const [entry] = await db
    .insert(userVocabulary)
    .values({
      userId: user.id,
      lexemeId: lexeme.id,
      sourceType: data.sourceType ?? "manual",
      sourceId: data.sourceId,
    })
    .returning();

  return NextResponse.json({ ok: true, id: entry!.id });
}
