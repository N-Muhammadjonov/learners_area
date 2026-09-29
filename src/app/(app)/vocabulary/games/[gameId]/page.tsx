import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listFolders } from "@/lib/services/vocabulary/engine";
import { TOPIC_PACKS, findPack } from "@/lib/services/vocabulary/packs";
import { isUuid } from "@/lib/validation/ids";
import type { GameSetKey, VocabFolder, VocabPack } from "@/components/vocabulary/types";
import { VocabGameView } from "@/components/vocabulary/VocabGamesPanel";
import { isGameId, isGameSetKey } from "@/lib/services/vocabulary/game-routes";

export default async function VocabularyGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ set?: string; folderId?: string; topicPack?: string }>;
}) {
  const [{ gameId }, query, user] = await Promise.all([params, searchParams, requireActiveUser()]);
  if (!user) return null;
  if (!isGameId(gameId)) notFound();
  const [locale, folders] = await Promise.all([getLocale(), listFolders(user.id)]);
  const dict = getDictionary(locale);
  const packs: VocabPack[] = TOPIC_PACKS.map((pack) => ({ id: pack.id, label: pack.label[locale], wordCount: pack.words.length }));
  const requestedSet = query.set ?? "";
  let setKey: GameSetKey = isGameSetKey(requestedSet) ? requestedSet : "due";
  let folderId = query.folderId && isUuid(query.folderId) ? query.folderId : undefined;
  let topicPack = query.topicPack;
  let sourceDetail: string | undefined;

  if (setKey === "folder") {
    if (!folderId) setKey = "due";
    else {
      sourceDetail = folders.find((folder) => folder.id === folderId)?.name;
      if (!sourceDetail) { folderId = undefined; setKey = "due"; }
    }
  }
  if (setKey === "topic") {
    const pack = topicPack ? findPack(topicPack) : null;
    if (pack) sourceDetail = pack.label[locale];
    else { topicPack = undefined; setKey = "due"; }
  }

  return <VocabGameView
    dict={dict}
    gameId={gameId}
    setKey={setKey}
    folderId={folderId}
    topicPack={topicPack}
    sourceDetail={sourceDetail}
    folders={folders as VocabFolder[]}
    packs={packs}
  />;
}
