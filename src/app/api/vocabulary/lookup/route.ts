import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireActiveUser } from "@/lib/auth/current-user";
import { resolveReadingOccurrence } from "@/lib/services/lexical/context";
import { isUuid } from "@/lib/validation/ids";
import { db } from "@/db/client";
import { userVocabulary } from "@/db/schema";

export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const sourceId = req.nextUrl.searchParams.get("sourceId") ?? "";
  const occurrenceId = req.nextUrl.searchParams.get("occurrenceId") ?? "";
  if (!isUuid(sourceId) || !isUuid(occurrenceId)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await resolveReadingOccurrence(user.id, sourceId, occurrenceId);
  if (!result) return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  const known = await db.query.userVocabulary.findFirst({ where: and(eq(userVocabulary.userId, user.id), eq(userVocabulary.lexemeId, result.lexeme.id)), columns: { id: true, mastery: true } });
  const { term, definitionEn, translationUz, partOfSpeech, provenance, verificationStatus } = result.lexeme;
  return NextResponse.json({ contextual: { term, definitionEn, translationUz, partOfSpeech, provenance, verificationStatus }, known: known ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
