import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireActiveUser } from "@/lib/auth/current-user";
import { lexicalDetailFor, resolveOccurrence } from "@/lib/services/lexical/context";
import { isUuid } from "@/lib/validation/ids";
import { db } from "@/db/client";
import { userVocabulary } from "@/db/schema";

const headers = { "Cache-Control": "private, no-store" };

/**
 * Exact-occurrence lookup for Reading and Listening. The meaning comes ONLY from
 * the sense linked to this occurrence; an occurrence without a checked sense is
 * answered as `unresolved` — never with another sense of the same spelling.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  const sourceType = req.nextUrl.searchParams.get("sourceType") ?? "reading";
  const sourceId = req.nextUrl.searchParams.get("sourceId") ?? "";
  const occurrenceId = req.nextUrl.searchParams.get("occurrenceId") ?? "";
  if (!["reading", "listening", "retention"].includes(sourceType) || !isUuid(sourceId) || !isUuid(occurrenceId)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400, headers });
  }
  const result = await resolveOccurrence(user, sourceType, sourceId, occurrenceId);
  if (!result) return NextResponse.json({ error: "source_not_found" }, { status: 404, headers });
  if (result.status === "locked") return NextResponse.json({ error: "lexical_assistance_locked" }, { status: 403, headers });
  if (result.status === "unresolved") {
    return NextResponse.json({ status: "unresolved", occurrenceId, surfaceForm: result.snapshot.surfaceForm, contextual: null, known: null }, { headers });
  }
  const known = await db.query.userVocabulary.findFirst({ where: and(eq(userVocabulary.userId, user.id), eq(userVocabulary.lexemeId, result.lexeme.id)), columns: { id: true, mastery: true } });
  const { term, definitionEn, translationUz, partOfSpeech, provenance, verificationStatus } = result.lexeme;
  const lexical = await lexicalDetailFor(result.lexeme);
  return NextResponse.json({
    status: "resolved", occurrenceId, senseId: result.lexeme.id,
    contextual: { term, definitionEn, translationUz, partOfSpeech, provenance, verificationStatus, lexicalType: lexical?.lexicalType ?? null, ipa: lexical?.ipa ?? null },
    known: known ?? null,
  }, { headers });
}
