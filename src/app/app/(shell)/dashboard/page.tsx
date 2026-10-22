import { MockProgressOverview } from "@/components/progress/MockProgressOverview";
import { Suspense } from "react";
import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/current-user";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale, type Locale } from "@/lib/i18n";
import { getDashboardData, getDashboardOpenLessons } from "@/lib/data/dashboard";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
import { StatCard, Card } from "@/components/ui/Card";
import { BandBadge, StateBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate, formatDateTime } from "@/lib/time";

const SKILLS = ["listening", "reading", "writing", "speaking"] as const;

async function DashboardContent({ user, locale, dict, openLessonsPromise }: {
  user: CurrentUser;
  locale: Locale;
  dict: ReturnType<typeof getDictionary>;
  openLessonsPromise: Promise<
    | { ok: true; lessons: Awaited<ReturnType<typeof getDashboardOpenLessons>> }
    | { ok: false }
  >;
}) {
  const data = await getDashboardData(user.id);
  const unavailable = Object.entries(data.unavailable).filter(([, failed]) => failed);
  return (
    <div className="flex flex-col gap-6" data-dashboard-content data-async-content="dashboard">
      {unavailable.map(([region]) => (
        <RegionFailureNotice
          key={region}
          region={`dashboard-${region}`}
          message={dict.errors.unknown}
          retryLabel={dict.errorPage.retry}
        />
      ))}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={dict.dashboard.targetBand} value={data.profile?.targetBand?.toFixed(1) ?? "—"} />
        <StatCard label={dict.dashboard.streak} value={data.streak === null ? "—" : String(data.streak)} />
        <StatCard label={dict.writing.historyTitle} value={data.writingAttempts === null ? "—" : String(data.writingAttempts)} />
        <StatCard label={dict.dashboard.vocabDue} value={data.vocabDueCount === null ? "—" : String(data.vocabDueCount)} />
      </div>

      {/* Continue where you left off — the newest row the student actually owns. */}
      <Card data-continue>
        <h2 className="font-display text-lg text-ink-900">{dict.dashboard.continueLearning}</h2>
        {data.unavailable.lastActivity ? (
          <p className="mt-2 text-sm text-ink-500" data-dashboard-region="last-activity-unavailable">{dict.errors.unknown}</p>
        ) : data.lastActivity ? (
          <>
            <p className="mt-1 text-sm text-ink-500" data-last-module={data.lastActivity.module}>
              {dict.dashboard.lastModule}: {dict.nav[data.lastActivity.module as "reading"]} ·{" "}
              {formatDateTime(data.lastActivity.at, locale)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={data.lastActivity.href} data-continue-link={data.lastActivity.href}>
                <Button>{dict.dashboard.pickUp}</Button>
              </Link>
              <Link href="/app/vocabulary">
                <Button variant="secondary">{dict.dashboard.reviewVocab}</Button>
              </Link>
            </div>
          </>
        ) : (
          <div className="mt-2" data-continue-empty>
            <p className="text-sm text-ink-500">{dict.dashboard.nothingYet}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/app/writing">
                <Button>{dict.dashboard.startWriting}</Button>
              </Link>
              <Link href="/app/vocabulary">
                <Button variant="secondary">{dict.dashboard.reviewVocab}</Button>
              </Link>
            </div>
          </div>
        )}
      </Card>

      {/* A four-minute drill that needs no test in front of it: read a passage once, cover it, write what you kept. */}
      <Card data-retention-drill>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-lg text-ink-900">{dict.reading.retentionModeTitle}</h2>
            <p className="mt-1 text-sm text-ink-500">{dict.dashboard.retentionDrillHint}</p>
          </div>
          <Link href="/app/reading/retention" prefetch={false}>
            <Button variant="secondary">{dict.dashboard.retentionDrillAction}</Button>
          </Link>
        </div>
      </Card>

      {/* My Tasks — the student's own open assignments, with their real due dates. */}
      <Card data-my-tasks>
        <h2 className="font-display text-lg text-ink-900">{dict.dashboard.myTasks}</h2>
        {data.openAssignments === null ? (
          <p className="mt-1 text-sm text-ink-500" data-tasks-unavailable>{dict.errors.unknown}</p>
        ) : data.openAssignments.length === 0 ? (
          <p className="mt-1 text-sm text-ink-500" data-tasks-empty>
            {dict.dashboard.noTasks}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-ink-100">
            {data.openAssignments.map((task) => (
              <li key={task.id} className="flex items-center justify-between py-2" data-task={task.id}>
                <span className="text-sm text-ink-900">{task.title}</span>
                <span className="text-xs text-ink-300">
                  {task.dueAt ? `${dict.assignments.due}: ${formatDate(task.dueAt, locale)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/app/assignments" className="btn-secondary mt-3">
          {dict.assignments.title} →
        </Link>
      </Card>

      <Suspense fallback={<DashboardOpenLessonsSkeleton />}>
        <DashboardOpenLessons openLessonsPromise={openLessonsPromise} dict={dict} />
      </Suspense>

      {data.nextLiveClass && (
        <Card data-next-live-class={data.nextLiveClass.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg text-ink-900">{dict.dashboard.nextClass}</h2>
            <span className="text-xs text-ink-300">{formatDateTime(data.nextLiveClass.scheduledAt, locale)}</span>
          </div>
          <p className="mt-1 text-sm text-ink-700">{data.nextLiveClass.title}</p>
          <Link href="/app/live-classes" className="btn-secondary mt-3">
            {dict.liveClasses.title} →
          </Link>
        </Card>
      )}

      {data.latestEvaluation && (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg text-ink-900">{dict.dashboard.recentFeedback}</h2>
            <BandBadge band={data.latestEvaluation.overallEstimate} />
          </div>
          {data.latestEvaluation.weaknesses[0] && (
            <p className="mt-2 text-sm text-ink-500">{data.latestEvaluation.weaknesses[0]}</p>
          )}
          <p className="mt-2 text-xs text-ink-300" data-checked-by={data.latestEvaluation.checkedByName}>
            {dict.coach.checkedBy} {data.latestEvaluation.checkedByName}
          </p>
          <Link href="/app/coach" className="btn-secondary mt-3">
            {dict.coach.title} →
          </Link>
        </Card>
      )}

      <div>
        <h2 className="mb-3 font-display text-lg text-ink-900">{dict.dashboard.skillSummary}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SKILLS.map((skill) => {
            const attempts = data.skillCounts[skill];
            return (
              <Card key={skill} className="flex flex-col gap-1" data-skill={skill}>
                <span className="text-sm font-medium text-ink-900">{dict.nav[skill]}</span>
                {attempts === null ? (
                  <span className="text-xs text-ink-300" data-skill-unavailable>—</span>
                ) : attempts === 0 ? (
                  <span className="text-xs text-ink-300">{dict.dashboard.noAttemptsYet}</span>
                ) : (
                  <span className="text-xs text-ink-500" data-skill-count={attempts}>
                    {attempts} {dict.dashboard.attempts}
                  </span>
                )}
                {skill === "writing" && data.latestEvaluation && <BandBadge band={data.latestEvaluation.overallEstimate} />}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

async function DashboardOpenLessons({ openLessonsPromise, dict }: {
  openLessonsPromise: Promise<
    | { ok: true; lessons: Awaited<ReturnType<typeof getDashboardOpenLessons>> }
    | { ok: false }
  >;
  dict: ReturnType<typeof getDictionary>;
}) {
  const result = await openLessonsPromise;
  if (!result.ok) {
    return (
      <Card data-open-lessons>
        <h2 className="font-display text-lg text-ink-900">{dict.dashboard.openNow}</h2>
        <RegionFailureNotice region="dashboard-open-lessons" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />
      </Card>
    );
  }
  const openLessons = result.lessons;

  return (
    <Card data-open-lessons>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-ink-900">{dict.dashboard.openNow}</h2>
        <Link href="/app/courses/ielts" className="btn-secondary ">
          {dict.dashboard.fullRoadmap} →
        </Link>
      </div>
      {openLessons.length === 0 ? (
        <p className="mt-1 text-sm text-ink-500" data-open-lessons-empty>
          {dict.dashboard.nothingOpenYet}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-ink-100">
          {openLessons.map((lesson) => (
            <li key={lesson.id} className="py-2" data-open-lesson={lesson.id}>
              <Link href={`/app/courses/ielts/lessons/${lesson.id}`} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm text-ink-900">{lesson.title}</span>
                  <span className="block text-xs text-ink-300">
                    {lesson.moduleTitle} · {lesson.unitTitle}
                  </span>
                </span>
                <span className="shrink-0" data-open-lesson-state={lesson.state}>
                  <StateBadge state={lesson.state as "available"} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DashboardOpenLessonsSkeleton() {
  return <div aria-hidden="true" className="h-40 animate-pulse rounded-xl bg-ink-50" data-async-loading="dashboard-open-lessons" />;
}

function DashboardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6" data-async-loading="dashboard">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((row) => <div key={row} className="h-24 animate-pulse rounded-xl bg-ink-50" />)}
      </div>
      {[0, 1, 2].map((row) => <div key={row} className="h-36 animate-pulse rounded-xl bg-ink-50" />)}
    </div>
  );
}

export default async function DashboardPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  // Start the roadmap read beside the dashboard summary rather than waiting for
  // every summary widget to settle before its independent region begins.
  const openLessonsPromise = getDashboardOpenLessons(user.id).then(
    (lessons) => ({ ok: true as const, lessons }),
    () => ({ ok: false as const }),
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="dashboard">
      <div>
        <h1 className="font-display text-2xl text-ink-900">
          {dict.dashboard.greeting}, {user.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-ink-500">{dict.nav.course} · IELTS</p>
      </div>
      <Suspense fallback={<DashboardSkeleton />}><MockProgressOverview userId={user.id} locale={locale} dashboard /></Suspense>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent user={user} locale={locale} dict={dict} openLessonsPromise={openLessonsPromise} />
      </Suspense>
    </div>
  );
}
