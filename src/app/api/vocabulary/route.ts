import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { addVocabularyBatch, librarySummary, listLibrary } from "@/lib/services/vocabulary/engine";

/**
 * The word library: read your own words, or add more in one action.
 *
 * Both the single-word form and a bulk paste go through the same engine call, so
 * deduplication, the SRS ladder and the points ledger behave identically however
 * the words arrived. Nothing about the award comes from the request.
 */
const itemSchema = z.object({
  term: z.string().trim().min(1).max(120),
  definitionEn: z.string().trim().min(1).max(500),
  translationUz: z.string().trim().max(500).nullish(),
  exampleSentence: z.string().trim().max(500).nullish(),
  partOfSpeech: z.string().trim().max(30).nullish(),
});

const addSchema = z.object({
  items: z.array(itemSchema).min(1).max(100),
  folderId: z.string().uuid().nullish(),
  topicPack: z.string().max(60).nullish(),
  sourceType: z.string().max(40).optional(),
  sourceId: z.string().uuid().nullish(),
});

export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 200) || 200));

  const [words, summary] = await Promise.all([
    listLibrary(user.id, { limit, offset }),
    librarySummary(user.id),
  ]);

  return NextResponse.json({ ok: true, words, total: summary.total, offset, limit });
}

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await addVocabularyBatch({
    userId: user.id,
    items: parsed.data.items,
    folderId: parsed.data.folderId ?? null,
    topicPack: parsed.data.topicPack ?? null,
    sourceType: parsed.data.sourceType ?? "manual",
    sourceId: parsed.data.sourceId ?? null,
  });

  return NextResponse.json({ ok: true, ...result });
}
