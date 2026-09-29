import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listSentenceBank, listLibrary } from "@/lib/services/vocabulary/engine";
import { timed } from "@/lib/observability/timing";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The Use It view can load its word picker and sentence history independently.
 * The unqualified response remains for existing callers that need both.
 */
export async function GET(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: PRIVATE_NO_STORE });

  const view = req.nextUrl.searchParams.get("view");
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const wordLimit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 100;

  try {
    if (view === "history") {
      const sentences = await timed("vocabulary.entry.sentenceHistory", () => listSentenceBank(user.id, 30));
      return NextResponse.json(
        { ok: true, sentences },
        { headers: PRIVATE_NO_STORE },
      );
    }

    if (view === "words") {
      const rows = await timed("vocabulary.entry.useItWords", () => listLibrary(user.id, { limit: wordLimit }));
      const words = rows.map((word) => ({
        id: word.id,
        term: word.term,
        definitionEn: word.definitionEn,
        translationUz: word.translationUz,
        mastery: word.mastery,
      }));
      return NextResponse.json(
        { ok: true, words },
        { headers: PRIVATE_NO_STORE },
      );
    }

    const [sentences, rows] = await Promise.all([
      timed("vocabulary.entry.sentenceHistory", () => listSentenceBank(user.id, 30)),
      timed("vocabulary.entry.useItWords", () => listLibrary(user.id, { limit: wordLimit })),
    ]);
    const words = rows.map((word) => ({
      id: word.id,
      term: word.term,
      definitionEn: word.definitionEn,
      translationUz: word.translationUz,
      mastery: word.mastery,
    }));
    return NextResponse.json(
      { ok: true, sentences, words },
      { headers: PRIVATE_NO_STORE },
    );
  } catch {
    return NextResponse.json({ ok: false, error: "temporarily_unavailable" }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
