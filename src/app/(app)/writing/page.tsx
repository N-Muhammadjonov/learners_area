import Link from "next/link";
import { Suspense } from "react";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActivePromptsWithResources, typingSummary } from "@/lib/data/writing";
import { timed } from "@/lib/observability/timing";
import { TypingTrainer } from "@/components/writing/TypingTrainer";
import { WritingExamHome } from "@/components/writing/exam/WritingExamHome";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
import { WritingNav } from "@/components/writing/workspace/WritingNav";
import { WritingGradeTab } from "@/components/writing/workspace/WritingGradeTab";
import { WritingLessonsTab, WritingContentTab } from "@/components/writing/workspace/WritingContentTabs";
import { parseWritingTab, WRITING_TABS, type WritingTab } from "@/lib/writing/tabs";

async function WritingTypingRegion({ typingPromise, targets, dict }: {
  typingPromise: Promise<
    | { ok: true; summary: Awaited<ReturnType<typeof typingSummary>> }
    | { ok: false }
  >;
  targets: { id: string; label: string; text: string }[];
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
      targets={targets}
      initialSummary={{ count: typing.count, bestWpm: typing.bestWpm, bestAccuracy: typing.bestAccuracy }}
    />
  );
}

async function WritingActivities({ userId, dict, view }: {
  userId: string;
  dict: ReturnType<typeof getDictionary>;
  view: "typing";
}) {
  const typingPromise = timed("writing.typingSummary", () => typingSummary(userId)).then(
    (summary) => ({ ok: true as const, summary }),
    () => ({ ok: false as const }),
  );
  const { prompts } = await timed("writing.promptsAndResources", listActivePromptsWithResources);
  const targets = prompts.map((prompt) => ({ id: prompt.id, label: prompt.category, text: prompt.prompt }));

  return (
    <div className="flex flex-col gap-6" data-writing-activities data-async-content="writing">
      {view === "typing" && <Suspense fallback={<TypingRegionSkeleton />}>
        <WritingTypingRegion typingPromise={typingPromise} targets={targets} dict={dict} />
      </Suspense>}
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

export default async function WritingPage({ searchParams }: { searchParams: Promise<{ tab?: string; view?: string }> }) {
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
        ) : tab === "typing" ? (
          <Suspense fallback={<WritingActivitiesSkeleton />}>
            <WritingActivities userId={user.id} dict={dict} view={tab} />
          </Suspense>
        ) : tab === "lessons" ? (
          <Suspense fallback={<WritingActivitiesSkeleton />}><WritingLessonsTab dict={dict} userId={user.id} /></Suspense>
        ) : (
          <Suspense fallback={<WritingActivitiesSkeleton />}><WritingContentTab dict={dict} tab={tab} /></Suspense>
        )}
      </div>
    </div>
  );
}
