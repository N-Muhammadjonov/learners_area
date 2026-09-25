import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getProgressData } from "@/lib/data/progress";
import { getDashboardData } from "@/lib/data/dashboard";
import { Card, StatCard } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/**
 * Progress, from the record.
 *
 * Everything on this page is a count or an average of rows the student owns. Where
 * a number cannot honestly exist — Speaking has no acoustic score by design — the
 * page says what it can count and does not invent the rest. Empty account, empty
 * page: no placeholder bands.
 */
export default async function ProgressPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(getLocale());
  const t = dict.progress;

  const [data, dashboard] = await Promise.all([getProgressData(user.id), getDashboardData(user.id)]);

  const modules = [
    {
      key: "reading",
      href: "/reading",
      attempts: data.reading.attempts,
      value: data.reading.accuracy === null ? null : `${data.reading.accuracy}%`,
      extra: `${data.reading.submitted} ${t.submitted}`,
    },
    {
      key: "listening",
      href: "/listening",
      attempts: data.listening.attempts,
      value: data.listening.accuracy === null ? null : `${data.listening.accuracy}%`,
      extra: `${data.listening.submitted} ${t.submitted}`,
    },
    {
      key: "writing",
      href: "/writing",
      attempts: data.writing.submissions,
      value: data.writing.latestBand === null ? null : `${data.writing.latestBand}`,
      extra: data.writing.latestBand === null ? t.noEstimateYet : t.latestEstimate,
    },
    {
      key: "speaking",
      href: "/speaking",
      attempts: data.speaking.attempts,
      value: null,
      extra: `${data.speaking.transcribed} ${t.transcribed}`,
    },
  ] as const;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.nav.progress}</h1>
        <p className="text-sm text-ink-500">{t.subtitle}</p>
      </div>

      <Card data-progress-modules>
        <h2 className="mb-3 font-display text-lg text-ink-900">{t.byModule}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {modules.map((module) => (
            <Link
              key={module.key}
              href={module.href}
              className="rounded-sm border border-ink-100 p-3 hover:bg-paper-sunken"
              data-progress-module={module.key}
              data-progress-attempts={module.attempts}
            >
              <p className="text-sm font-medium text-ink-900">{dict.nav[module.key]}</p>
              <p className="mt-1 text-xs text-ink-300">{module.attempts} {t.attempts}</p>
              <p className="mt-2 text-sm text-ink-900" data-progress-value={module.value ?? "none"}>
                {module.value ?? t.noScore}
              </p>
              <p className="text-xs text-ink-300">{module.extra}</p>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-300" data-progress-note>
          {t.speakingNote}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={dict.dashboard.streak} value={String(dashboard.streak)} />
        <StatCard label={dict.dashboard.vocabDue} value={String(data.vocabulary.due)} />
        <StatCard label={t.vocabTotal} value={String(data.vocabulary.total)} />
      </div>

      <Card data-progress-vocabulary>
        <h2 className="mb-2 font-display text-lg text-ink-900">{t.vocabulary}</h2>
        <ul className="flex flex-wrap gap-3 text-sm">
          {(
            [
              ["new", data.vocabulary.byState.new],
              ["learning", data.vocabulary.byState.learning],
              ["review", data.vocabulary.byState.review],
              ["known", data.vocabulary.byState.known],
              ["mastered", data.vocabulary.byState.mastered],
              ["activated", data.vocabulary.byState.activated],
            ] as const
          ).map(([state, value]) => (
            <li key={state} className="text-ink-500" data-vocab-state={state}>
              {t.states[state]}: <span className="text-ink-900">{value}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card data-progress-course>
        <h2 className="mb-2 font-display text-lg text-ink-900">{t.course}</h2>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between">
            <dt className="text-ink-500">{t.lessonsCompleted}</dt>
            <dd className="text-ink-900" data-lessons-completed={data.lessons.completed}>
              {data.lessons.completed} / {data.lessons.total}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">{t.lessonsOpen}</dt>
            <dd className="text-ink-900">{data.lessons.open}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">{t.assignmentsOpen}</dt>
            <dd className="text-ink-900" data-assignments-open={data.assignments.open}>
              {data.assignments.open} / {data.assignments.total}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">{t.mocksTaken}</dt>
            <dd className="text-ink-900">
              {data.mocks.finished}
              {data.mocks.bestBand === null ? "" : ` · ${t.bestBand} ${data.mocks.bestBand}`}
            </dd>
          </div>
        </dl>
        <Link href="/courses/ielts" className="mt-3 inline-block text-sm text-signal-600 hover:underline">
          {dict.courseRoadmap.open} →
        </Link>
      </Card>
    </div>
  );
}
