import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { addVocabularyBatch, librarySummary, listLibrary } from "@/lib/services/vocabulary/engine";
import { enrichTerms } from "@/lib/services/lexical/enrichment";

/**
 * The word library: read your own words, or add more in one action.
 *
 * Both the single-word form and a bulk paste go through the same engine call, so
 * deduplication, the SRS ladder and the points ledger behave identically however
 * the words arrived. Nothing about the award comes from the request.
 */
const itemSchema = z.object({
  term: z.string().trim().min(1).max(120),
  // Optional on purpose: when the caller has no meaning for the word, the server
  // asks the lexical sources instead of accepting an invented one.
  definitionEn: z.string().trim().min(1).max(500).optional(),
  translationUz: z.string().trim().max(500).nullish(),
  exampleSentence: z.string().trim().max(500).nullish(),
  partOfSpeech: z.string().trim().max(30).nullish(),
  // The extra answers the Translation challenge accepts, authored by staff when
  // a word has more than one correct rendering. Capped here as well as in the
  // engine: shared lexical rows must not be bloated by a caller.
  acceptedTranslations: z.array(z.string().trim().min(1).max(120)).max(4).optional(),
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

  // Words that arrived without a meaning are completed from the configured
  // lexical sources. Anything no source knows is NOT stored with a made-up
  // definition: it is reported back so a human can write the meaning.
  const missing = parsed.data.items.filter((item) => !item.definitionEn).map((item) => item.term);

  const items = [...parsed.data.items];
  const unresolved: string[] = [];
  if (missing.length > 0) {
    const { entries, unresolved: unknown } = await enrichTerms(missing);
    unresolved.push(...unknown);
    for (const item of items) {
      if (item.definitionEn) continue;
      const entry = entries.get(item.term);
      if (!entry) continue;
      item.definitionEn = entry.definitionEn;
      item.translationUz = item.translationUz ?? entry.translationUz;
      item.exampleSentence = item.exampleSentence ?? entry.exampleSentence;
      item.partOfSpeech = item.partOfSpeech ?? entry.partOfSpeech;
    }
  }

  const storable = items.filter((item) => Boolean(item.definitionEn));
  if (storable.length === 0) {
    return NextResponse.json({ ok: false, error: "needs_definition", needsDefinition: unresolved }, { status: 422 });
  }

  const result = await addVocabularyBatch({
    userId: user.id,
    items: storable.map((item) => ({ ...item, definitionEn: item.definitionEn as string })),
    folderId: parsed.data.folderId ?? null,
    topicPack: parsed.data.topicPack ?? null,
    sourceType: parsed.data.sourceType ?? "manual",
    sourceId: parsed.data.sourceId ?? null,
  });
  // A folder id that is not the caller's own is refused, not silently ignored.
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });

  return NextResponse.json({
    ok: true,
    added: result.added,
    duplicates: result.duplicates,
    ids: result.ids,
    points: result.points,
    needsDefinition: unresolved,
  });
}
