import { Suspense } from "react";
import { requireActiveUser } from "@/lib/auth/current-user";
import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActivePromptsWithResources, typingSummary } from "@/lib/data/writing";
import { timed } from "@/lib/observability/timing";
import { Card } from "@/components/ui/Card";
import { StartPromptButton } from "@/components/writing/StartPromptButton";
import { TypingTrainer } from "@/components/writing/TypingTrainer";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";

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

async function WritingActivities({ userId, dict }: {
  userId: string;
  dict: ReturnType<typeof getDictionary>;
}) {
  const typingPromise = timed("writing.typingSummary", () => typingSummary(userId)).then(
    (summary) => ({ ok: true as const, summary }),
    () => ({ ok: false as const }),
  );
  const { prompts, materials } = await timed("writing.promptsAndResources", listActivePromptsWithResources);
  const targets = prompts.map((prompt) => ({ id: prompt.id, label: prompt.category, text: prompt.prompt }));

  return (
    <div className="flex flex-col gap-6" data-writing-activities data-async-content="writing">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {prompts.map((prompt) => (
          <Card key={prompt.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="badge bg-signal-100 text-signal-700">
                {prompt.taskType === "task1" ? dict.writing.task1 : dict.writing.task2}
              </span>
              <span className="text-xs uppercase tracking-wide text-ink-300">{prompt.category}</span>
            </div>
            <p className="text-sm text-ink-700">{prompt.prompt}</p>
            <div className="flex items-center justify-between text-xs text-ink-300">
              <span>{dict.writing.target}: {prompt.targetWordCount} {dict.common.words}</span>
              <StartPromptButton promptId={prompt.id} label={dict.common.continue} />
            </div>
            <ResourceBlocks dict={dict} blocks={materials.get(prompt.id) ?? []} />
          </Card>
        ))}
      </div>
      <Suspense fallback={<TypingRegionSkeleton />}>
        <WritingTypingRegion typingPromise={typingPromise} targets={targets} dict={dict} />
      </Suspense>
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

export default async function WritingPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6" data-route-usable="writing">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl text-ink-900">{dict.writing.practiceTitle}</h1>
        <Link href="/writing/history" className="text-sm text-signal-600 hover:underline">
          {dict.writing.historyTitle} →
        </Link>
      </div>
      <Suspense fallback={<WritingActivitiesSkeleton />}>
        <WritingActivities userId={user.id} dict={dict} />
      </Suspense>
    </div>
  );
}
