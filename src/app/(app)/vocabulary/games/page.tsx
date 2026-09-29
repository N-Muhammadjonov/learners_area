import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { TOPIC_PACKS } from "@/lib/services/vocabulary/packs";
import { listFolders } from "@/lib/services/vocabulary/engine";
import { VocabGamesPanel } from "@/components/vocabulary/VocabGamesPanel";

export default async function VocabularyGamesPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const [locale, folders] = await Promise.all([getLocale(), listFolders(user.id)]);
  const dict = getDictionary(locale);
  const packs = TOPIC_PACKS.map((pack) => ({ id: pack.id, label: pack.label[locale], wordCount: pack.words.length }));
  return <VocabGamesPanel dict={dict} folders={folders} packs={packs} />;
}
