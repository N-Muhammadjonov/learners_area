import { Suspense } from "react";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getProgressData } from "@/lib/data/progress";
import { getDashboardData } from "@/lib/data/dashboard";
import { Card, StatCard } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

async function ProgressContent({ userId, dict }: {
  userId: string;
  dict: ReturnType<typeof getDictionary>;
}) {
  const [data, dashboard] = await Promise.all([getProgressData(userId), getDashboardData(userId)]);
  const t = dict.progress;
  const modules = [
    { key: "reading", href: "/reading", attempts: data.reading.attempts, value: data.reading.accuracy === null ? null : `${data.reading.accuracy}%`, extra: `${data.reading.submitted} ${t.submitted}` },
    { key: "listening", href: "/listening", attempts: data.listening.attempts, value: data.listening.accuracy === null ? null : `${data.listening.accuracy}%`, extra: `${data.listening.submitted} ${t.submitted}` },
    { key: "writing", href: "/writing", attempts: data.writing.submissions, value: data.writing.latestBand === null ? null : `${data.writing.latestBand}`, extra: data.writing.latestBand === null ? t.noEstimateYet : t.latestEstimate },
    { key: "speaking", href: "/speaking", attempts: data.speaking.attempts, value: null, extra: `${data.speaking.transcribed} ${t.transcribed}` },
  ] as const;

  return (
    <div className="flex flex-col gap-4" data-progress-content data-async-content="progress">
      <Card data-progress-modules>
        <h2 className="mb-3 font-display text-lg text-ink-900">{t.byModule}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {modules.map((module) => (
            <Link key={module.key} href={module.href} className="rounded-sm border border-ink-100 p-3 hover:bg-paper-sunken" data-progress-module={module.key} data-progress-attempts={module.attempts}>
              <p className="text-sm font-medium text-ink-900">{dict.nav[module.key]}</p>
              <p className="mt-1 text-xs text-ink-300">{module.attempts} {t.attempts}</p>
              <p className="mt-2 text-sm text-ink-900" data-progress-value={module.value ?? "none"}>{module.value ?? t.noScore}</p>
              <p className="text-xs text-ink-300">{module.extra}</p>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-300" data-progress-note>{t.speakingNote}</p>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={dict.dashboard.streak} value={String(dashboard.streak)} />
        <StatCard label={dict.dashboard.vocabDue} value={String(data.vocabulary.due)} />
        <StatCard label={t.vocabTotal} value={String(data.vocabulary.total)} />
      </div>

      <Card data-progress-vocabulary>
        <h2 className="mb-2 font-display text-lg text-ink-900">{t.vocabulary}</h2>
        <ul className="flex flex-wrap gap-3 text-sm">
          {(["new", "learning", "review", "known", "mastered", "activated"] as const).map((state) => (
            <li key={state} className="text-ink-500" data-vocab-state={state}>
              {t.states[state]}: <span className="text-ink-900">{data.vocabulary.byState[state]}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card data-progress-course>
        <h2 className="mb-2 font-display text-lg text-ink-900">{t.course}</h2>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between"><dt className="text-ink-500">{t.lessonsCompleted}</dt><dd className="text-ink-900" data-lessons-completed={data.lessons.completed}>{data.lessons.completed} / {data.lessons.total}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-500">{t.lessonsOpen}</dt><dd className="text-ink-900">{data.lessons.open}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-500">{t.assignmentsOpen}</dt><dd className="text-ink-900" data-assignments-open={data.assignments.open}>{data.assignments.open} / {data.assignments.total}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-500">{t.mocksTaken}</dt><dd className="text-ink-900">{data.mocks.finished}{data.mocks.bestBand === null ? "" : ` · ${t.bestBand} ${data.mocks.bestBand}`}</dd></div>
        </dl>
        <Link href="/courses/ielts" className="mt-3 inline-block text-sm text-signal-600 hover:underline">{dict.courseRoadmap.open} →</Link>
      </Card>
    </div>
  );
}

function ProgressSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4" data-async-loading="progress">
      <div className="h-32 animate-pulse rounded-xl bg-ink-50" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="col-span-3 h-24 animate-pulse rounded-xl bg-ink-50" /></div>
      <div className="h-40 animate-pulse rounded-xl bg-ink-50" />
    </div>
  );
}

export default async function ProgressPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-route-usable="progress">
      <div><h1 className="font-display text-2xl text-ink-900">{dict.nav.progress}</h1><p className="text-sm text-ink-500">{dict.progress.subtitle}</p></div>
      <Suspense fallback={<ProgressSkeleton />}><ProgressContent userId={user.id} dict={dict} /></Suspense>
    </div>
  );
}
