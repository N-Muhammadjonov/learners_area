import { requireActiveUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
import { getDictionary, getLocale } from "@/lib/i18n";
import { TOPIC_PACKS } from "@/lib/services/vocabulary/packs";
import { VocabStudio } from "@/components/vocabulary/VocabStudio";
import type { TabKey } from "@/components/vocabulary/types";

function selectedTab(value: string | undefined): TabKey {
  if (value === "games") redirect("/vocabulary/games");
  return value === "use" || value === "board" || value === "revision" ? value : "words";
}

export default async function VocabularyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [user, locale, params] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const packs = TOPIC_PACKS.map((pack) => ({ id: pack.id, label: pack.label[locale], wordCount: pack.words.length }));

  // Only the authoritative identity and locale gate this small server frame.
  // The selected tab starts its own private request after the frame has mounted.
  return (
    <div data-route-usable="vocabulary" data-vocabulary-route>
      <VocabStudio dict={dict} initialTab={selectedTab(params.tab)} packs={packs} />
    </div>
  );
}
