import { Suspense } from "react";
import type { Dictionary } from "@/lib/i18n/en";
import type { Locale } from "@/lib/i18n";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listTopicPackSummariesForLearner } from "@/lib/content/vocabulary-packs";
import { listFolders } from "@/lib/services/vocabulary/engine";
import { VocabGamesPanel } from "@/components/vocabulary/VocabGamesPanel";
import { isGameSetKey } from "@/lib/services/vocabulary/game-routes";

export default async function VocabularyGamesPage({ searchParams }: { searchParams: Promise<{ set?: string; folderId?: string; topicPack?: string }> }) {
  const [user, query] = await Promise.all([requireActiveUser(), searchParams]);
  if (!user) return null;
  const locale = await getLocale();
  const dict = getDictionary(locale);
  return <div data-route-usable="vocabulary-games">
    <Suspense fallback={<div role="status" data-async-loading="vocabulary-games"><h1 className="page-title">{dict.vocabulary.tab.games}</h1><p>{dict.common.loading}</p></div>}>
      <GamesContent query={query} userId={user.id} locale={locale} dict={dict} />
    </Suspense>
  </div>;
}

async function GamesContent({ query, userId, locale, dict }: {
  query: { set?: string; folderId?: string; topicPack?: string };
  userId: string; locale: Locale; dict: Dictionary;
}) {
  const [folders, summaries] = await Promise.all([listFolders(userId), listTopicPackSummariesForLearner(locale)]);
  const packs = summaries.map((pack) => ({ id: pack.id, label: pack.label, wordCount: pack.wordCount }));
  const requestedSet = query.set ?? "";
  let initialSetKey = isGameSetKey(requestedSet) ? requestedSet : "due";
  const initialFolderId = query.folderId && folders.some((folder) => folder.id === query.folderId) ? query.folderId : undefined;
  const initialTopicPack = query.topicPack && packs.some((pack) => pack.id === query.topicPack) ? query.topicPack : undefined;
  if (initialSetKey === "folder" && !initialFolderId) initialSetKey = "due";
  if (initialSetKey === "topic" && !initialTopicPack) initialSetKey = "due";
  return <VocabGamesPanel
    dict={dict}
    folders={folders}
    packs={packs}
    initialSetKey={initialSetKey}
    initialFolderId={initialFolderId}
    initialTopicPack={initialTopicPack}
  />;
}
