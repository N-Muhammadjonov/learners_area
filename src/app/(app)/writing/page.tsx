import Link from "next/link";
import { Suspense } from "react";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listWritingModelTexts, typingStats, type ModelTextView } from "@/lib/services/writing/typing-runs";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { timed } from "@/lib/observability/timing";
import { TypingTrainer } from "@/components/writing/TypingTrainer";
import { WritingExamHome } from "@/components/writing/exam/WritingExamHome";
import { WritingTopicVocabularyTab } from "@/components/writing/topic/WritingTopicVocabularyTab";
import { WritingTranslationTab } from "@/components/writing/translation/WritingTranslationTab";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
import { WritingActivationTab } from "@/components/writing/activation/WritingActivationTab";
import { WritingNav } from "@/components/writing/workspace/WritingNav";
import { WritingGradeTab } from "@/components/writing/workspace/WritingGradeTab";
import { WritingLessonsTab, WritingContentTab } from "@/components/writing/workspace/WritingContentTabs";
import { parseWritingTab, WRITING_TABS, type WritingTab } from "@/lib/writing/tabs";

async function WritingTypingRegion({ typingPromise, texts, dict }: {
  typingPromise: Promise<
    | { ok: true; summary: Awaited<ReturnType<typeof typingStats>> }
    | { ok: false }
  >;
  texts: ModelTextView[];
  dict: ReturnType<typeof getDictionary>;
}) {
  const result = await typingPromise;
  if (!result.ok) {
    return <RegionFailureNotice region="writing-typing-summary" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />;
  }
  const typing = result.summary;
  return (
    <TypingTrainer
      dict={dict}
      texts={texts}
      initialSummary={{ count: typing.count, bestWpm: typing.bestWpm, bestAccuracy: typing.bestAccuracy }}
      initialHistory={typing.history}
    />
  );
}

/**
 * Typing (§41): complete Band 8–9 model texts from writing_model_texts —
 * never Writing question prompts. Stats start before the text query resolves.
 */
async function WritingActivities({ userId, dict }: {
  userId: string;
  dict: ReturnType<typeof getDictionary>;
}) {
  const t = dict.writingWorkspace.typing;
  const typingPromise = timed("writing.typingSummary", () => typingStats(userId)).then(
    (summary) => ({ ok: true as const, summary }),
    () => ({ ok: false as const }),
  );
  const loaded = await safeWritingQuery(() => timed("writing.modelTexts", () => listWritingModelTexts()));
  if (!loaded.ok) { void typingPromise; return <NotMigrated dict={dict} />; }
  const texts = loaded.value;

  return (
    <div className="flex flex-col gap-5" data-writing-activities data-async-content="writing">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">{t.eyebrow}</p>
        <h2 className="font-display text-xl text-ink-900">{t.title}</h2>
        <p className="mt-1 max-w-3xl text-base text-ink-500">{t.body}</p>
      </div>
      {texts.length === 0 ? (
        <p role="status" className="rounded-md border border-ink-100 bg-paper-sunken p-4 text-base text-ink-700" data-typing-no-texts>{t.noTexts}</p>
      ) : (
        <Suspense fallback={<TypingRegionSkeleton />}>
          <WritingTypingRegion typingPromise={typingPromise} texts={texts} dict={dict} />
        </Suspense>
      )}
    </div>
  );
}

function WritingActivitiesSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6" data-async-loading="writing">
      {[0, 1].map((row) => <div key={row} className="h-40 animate-pulse rounded-xl bg-ink-50" />)}
    </div>
  );
}

function TypingRegionSkeleton() {
  return <div aria-hidden="true" className="h-48 animate-pulse rounded-xl bg-ink-50" data-async-loading="writing-typing-summary" />;
}

export default async function WritingPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string; topic?: string; task?: string; fn?: string; item?: string }> }) {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  const sp = await searchParams;
  if (!user) return null;
  const dict = getDictionary(locale);
  const tab: WritingTab = parseWritingTab(sp.tab);
  const labels = Object.fromEntries(WRITING_TABS.map((k) => [k, dict.writingWorkspace.tabs[k]])) as Record<WritingTab, string>;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-route-usable="writing" data-writing-active-tab={tab}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-ink-900">{dict.writingWorkspace.title}</h1>
          <p className="mt-1 text-base text-ink-500">{dict.writingWorkspace.intro}</p>
        </div>
        <Link href="/writing/history" className="btn-secondary" data-writing-history-link>{dict.writing.historyTitle} →</Link>
      </div>
      <WritingNav active={tab} labels={labels} label={dict.writingWorkspace.tabsLabel} />
      <div role="tabpanel" id="writing-panel" aria-labelledby={`writing-tab-${tab}`} className="motion-tab-panel" key={tab}>
        {tab === "grade" ? (
          <WritingGradeTab dict={dict} userId={user.id} view={sp.view === "essays" ? "essays" : "new"} locale={locale} />
        ) : tab === "exam" ? (
          <Suspense fallback={<WritingActivitiesSkeleton />}><WritingExamHome dict={dict} userId={user.id} locale={locale} /></Suspense>
        ) : tab === "translation" ? (
          <Suspense fallback={<WritingActivitiesSkeleton />}><WritingTranslationTab dict={dict} userId={user.id} /></Suspense>
        ) : tab === "topic-vocabulary" ? (
          <Suspense fallback={<WritingActivitiesSkeleton />}><WritingTopicVocabularyTab dict={dict} userId={user.id} locale={locale} params={{ topic: sp.topic, task: sp.task, fn: sp.fn }} /></Suspense>
        ) : tab === "typing" ? (
          <Suspense fallback={<WritingActivitiesSkeleton />}>
            <WritingActivities userId={user.id} dict={dict} />
          </Suspense>
        ) : tab === "activation" ? (
          <Suspense fallback={<WritingActivitiesSkeleton />}><WritingActivationTab dict={dict} userId={user.id} item={sp.item} locale={locale} /></Suspense>
        ) : tab === "lessons" ? (
          <Suspense fallback={<WritingActivitiesSkeleton />}><WritingLessonsTab dict={dict} userId={user.id} /></Suspense>
        ) : (
          <Suspense fallback={<WritingActivitiesSkeleton />}><WritingContentTab dict={dict} tab={tab} /></Suspense>
        )}
      </div>
    </div>
  );
}
