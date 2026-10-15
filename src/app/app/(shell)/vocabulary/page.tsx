import { requireActiveUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listTopicPacksForLearner } from "@/lib/content/vocabulary-packs";
import { VocabStudio } from "@/components/vocabulary/VocabStudio";
import type { TabKey } from "@/components/vocabulary/types";

function selectedTab(value: string | undefined): TabKey {
  if (value === "games") redirect("/app/vocabulary/games");
  return value === "use" || value === "board" || value === "revision" || value === "dictionary" ? value : "words";
}

export default async function VocabularyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [user, locale, params] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const tab = selectedTab(params.tab);
  // Resolve the entry frame immediately. The selected learner catalogue is
  // streamed independently, without loading every vocabulary word into it.
  const packsPromise = listTopicPacksForLearner(locale);

  // Only the authoritative identity and locale gate this small server frame.
  // The selected tab starts its own private request after the frame has mounted.
  return (
    <div data-route-usable="vocabulary" data-vocabulary-route>
      <Suspense fallback={<div role="status" aria-busy="true" aria-label={dict.common.loading} data-async-loading="vocabulary-topic-packs" className="h-36 animate-pulse rounded-xl bg-ink-50" />}>
        <VocabularyPacksRegion packsPromise={packsPromise} dict={dict} tab={tab} />
      </Suspense>
    </div>
  );
}

async function VocabularyPacksRegion({ packsPromise, dict, tab }: {
  packsPromise: ReturnType<typeof listTopicPacksForLearner>;
  dict: ReturnType<typeof getDictionary>;
  tab: TabKey;
}) {
  const packs = (await packsPromise).map((pack) => ({ id: pack.id, label: pack.label, wordCount: pack.words.length }));
  return <VocabStudio dict={dict} initialTab={tab} packs={packs} />;
}
