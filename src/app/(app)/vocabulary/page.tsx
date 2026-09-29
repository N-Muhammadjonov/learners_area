import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { timed } from "@/lib/observability/timing";
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
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const user = await requireActiveUser();
  if (!user) return null;

  const locale = await getLocale();
  const dict = getDictionary(locale);

  const [words, due, folders, summary, standing, sentences] = await Promise.all([
    timed("vocabulary.words", () => listLibrary(user.id, { limit: 200 })),
    timed("vocabulary.due", () => listDue(user.id, 40)),
    timed("vocabulary.folders", () => listFolders(user.id)),
    timed("vocabulary.summary", () => librarySummary(user.id)),
    timed("vocabulary.standing", () => getStanding(user.id)),
    timed("vocabulary.sentences", () => listSentenceBank(user.id, 30)),
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
      tab === "games" ||
      tab === "use" ||
      tab === "board" ||
      tab === "revision"
        ? tab
        : "words",
  };

  return <VocabStudio dict={dict} data={data} />;
}
