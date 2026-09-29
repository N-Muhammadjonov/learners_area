import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { TOPIC_PACKS } from "@/lib/services/vocabulary/packs";
import { listFolders } from "@/lib/services/vocabulary/engine";
import { VocabGamesPanel } from "@/components/vocabulary/VocabGamesPanel";
import { isGameSetKey } from "@/lib/services/vocabulary/game-routes";

export default async function VocabularyGamesPage({ searchParams }: { searchParams: Promise<{ set?: string; folderId?: string; topicPack?: string }> }) {
  const [user, query] = await Promise.all([requireActiveUser(), searchParams]);
  if (!user) return null;
  const [locale, folders] = await Promise.all([getLocale(), listFolders(user.id)]);
  const dict = getDictionary(locale);
  const packs = TOPIC_PACKS.map((pack) => ({ id: pack.id, label: pack.label[locale], wordCount: pack.words.length }));
  const requestedSet = query.set ?? "";
  let initialSetKey = isGameSetKey(requestedSet) ? requestedSet : "due";
  const initialFolderId = query.folderId && folders.some((folder) => folder.id === query.folderId) ? query.folderId : undefined;
  const initialTopicPack = query.topicPack && TOPIC_PACKS.some((pack) => pack.id === query.topicPack) ? query.topicPack : undefined;
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
