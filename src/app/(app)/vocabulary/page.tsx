import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { TOPIC_PACKS } from "@/lib/services/vocabulary/packs";
import {
  getStanding,
  librarySummary,
  listDue,
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
  searchParams?: { tab?: string };
}) {
  const user = await requireActiveUser();
  if (!user) return null;

  const dict = getDictionary(getLocale());
  const locale = getLocale();

  const [words, due, folders, summary, standing, sentences] = await Promise.all([
    listLibrary(user.id, { limit: 200 }),
    listDue(user.id, 40),
    listFolders(user.id),
    librarySummary(user.id),
    getStanding(user.id),
    listSentenceBank(user.id, 30),
  ]);

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
      searchParams?.tab === "games" ||
      searchParams?.tab === "use" ||
      searchParams?.tab === "board" ||
      searchParams?.tab === "revision"
        ? searchParams.tab
        : "words",
  };

  return <VocabStudio dict={dict} data={data} />;
}
