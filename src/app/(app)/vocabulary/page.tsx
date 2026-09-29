import { Suspense } from "react";
import { requireActiveUser } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
import { getDictionary, getLocale } from "@/lib/i18n";
import { timed } from "@/lib/observability/timing";
import { TOPIC_PACKS } from "@/lib/services/vocabulary/packs";
import { getStanding, listFolders, listLibrary, listSentenceBank } from "@/lib/services/vocabulary/engine";
import { VocabStudio, type VocabStudioData } from "@/components/vocabulary/VocabStudio";

/** The vocabulary panels remain request-authenticated; the data reads only begin after the gate. */
async function VocabularyWorkspace({ userId, locale, tab, dict }: {
  userId: string;
  locale: "uz" | "en";
  tab?: string;
  dict: ReturnType<typeof getDictionary>;
}) {
  const [library, folders, standing, sentences] = await Promise.all([
    timed("vocabulary.library", () => listLibrary(userId, { limit: 500 })),
    timed("vocabulary.folders", () => listFolders(userId)),
    timed("vocabulary.standing", () => getStanding(userId)),
    timed("vocabulary.sentences", () => listSentenceBank(userId, 30)),
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
    packs: TOPIC_PACKS.map((pack) => ({ id: pack.id, label: pack.label[locale], wordCount: pack.words.length })),
    initialTab: tab === "games" || tab === "use" || tab === "board" || tab === "revision" ? tab : "words",
  };
  return <VocabStudio dict={dict} data={data} />;
}

function VocabularyWorkspaceSkeleton({ dict }: { dict: ReturnType<typeof getDictionary> }) {
  return (
    <section aria-busy="true" aria-live="polite" className="mx-auto flex w-full max-w-6xl flex-col gap-4" data-async-loading="vocabulary">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.vocabulary.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{dict.vocabulary.search.hint}</p>
      </div>
      <div aria-hidden="true" className="flex gap-1 rounded-md border border-ink-100 p-1">
        {[0, 1, 2, 3, 4].map((tab) => <span key={tab} className="h-10 flex-1 animate-pulse rounded bg-ink-50" />)}
      </div>
      {[0, 1, 2].map((row) => <div key={row} aria-hidden="true" className="h-40 animate-pulse rounded-xl bg-ink-50" />)}
    </section>
  );
}

export default async function VocabularyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [user, locale, params] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  if (params.tab === "games") redirect("/vocabulary/games");
  const dict = getDictionary(locale);

  return (
    <div data-route-usable="vocabulary" data-vocabulary-route>
      <Suspense fallback={<VocabularyWorkspaceSkeleton dict={dict} />}>
        <VocabularyWorkspace userId={user.id} locale={locale} tab={params.tab} dict={dict} />
      </Suspense>
    </div>
  );
}
