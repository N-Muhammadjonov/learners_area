import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/current-user";
import { listSentenceBank, listLibrary } from "@/lib/services/vocabulary/engine";

/**
 * GET /api/vocabulary/sentences — the Sentence Bank, plus the words it can be
 * written about. Scoped to the caller: there is no parameter for another
 * student's sentences and no way to reach one.
 */
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [sentences, words] = await Promise.all([
    listSentenceBank(user.id, 50),
    listLibrary(user.id, { limit: 200 }),
  ]);

  return NextResponse.json({
    ok: true,
    sentences,
    words: words.map((word) => ({
      id: word.id,
      term: word.term,
      definitionEn: word.definitionEn,
      translationUz: word.translationUz,
      mastery: word.mastery,
    })),
  });
}
