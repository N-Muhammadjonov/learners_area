import { requireActiveUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
import { getDictionary, getLocale } from "@/lib/i18n";
import { timed } from "@/lib/observability/timing";
import { TOPIC_PACKS } from "@/lib/services/vocabulary/packs";
import {
  getStanding,
  listFolders,
  listLibrary,
  listSentenceBank,
} from "@/lib/services/vocabulary/engine";
import { VocabStudio, type VocabStudioData } from "@/components/vocabulary/VocabStudio";

/**
 * The Vocabulary section.
 *
 * One page, five views — MY WORDS / REVISION / GAMES / USE IT / LEADERBOARD —
 * fed by one engine. The server loads the first paint with real rows (no
 * placeholders, no sample numbers); every later action goes through
 * /api/vocabulary/*, where authorization and scoring live.
 */
export default async function VocabularyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  if (tab === "games") redirect("/vocabulary/games");


  const dict = getDictionary(locale);

  const [library, folders, standing, sentences] = await Promise.all([
    timed("vocabulary.library", () => listLibrary(user.id, { limit: 500 })),
    timed("vocabulary.folders", () => listFolders(user.id)),
    timed("vocabulary.standing", () => getStanding(user.id)),
    timed("vocabulary.sentences", () => listSentenceBank(user.id, 30)),
  ]);
  const words = library.slice(0, 200);
  const due = library.filter((item) => new Date(item.nextReviewAt).getTime() <= Date.now()).slice(0, 40);
  const byMastery = library.reduce<Record<string, number>>((counts, item) => {
    counts[item.mastery] = (counts[item.mastery] ?? 0) + 1;
    return counts;
  }, {});
  const summary = {
    total: library.length,
    due: library.filter((item) => new Date(item.nextReviewAt).getTime() <= Date.now()).length,
    byMastery,
    nextDueAt: due[0]?.nextReviewAt ?? null,
  };

  const data: VocabStudioData = {
    words,
    due,
    folders,
    summary,
    standing,
    sentences,
    packs: TOPIC_PACKS.map((pack) => ({
      id: pack.id,
      label: pack.label[locale],
      wordCount: pack.words.length,
    })),
    initialTab:
      tab === "games" ||
      tab === "use" ||
      tab === "board" ||
      tab === "revision"
        ? tab
        : "words",
  };

  return <VocabStudio dict={dict} data={data} />;
}
