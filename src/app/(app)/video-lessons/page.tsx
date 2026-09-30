import { Suspense } from "react";
import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/current-user";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listVideoLessonsForStudent } from "@/lib/data/video-lessons";
import { isOpen, type LessonState } from "@/lib/services/lessons/state";
import { Card } from "@/components/ui/Card";
import { StateBadge } from "@/components/ui/Badge";
import { timed } from "@/lib/observability/timing";

export const dynamic = "force-dynamic";

async function VideoLessonsContent({ user, dict }: {
  user: CurrentUser;
  dict: ReturnType<typeof getDictionary>;
}) {
  const t = dict.videoLessons;
  const all = await timed("videoLessons.entry.catalogue", () => listVideoLessonsForStudent(user.id));
  const openable = all.filter((row) => isOpen(row.state as LessonState));

  return openable.length === 0 ? (
    <Card>
      <p className="text-sm text-ink-500" data-video-lessons-empty>{t.none}</p>
    </Card>
  ) : (
    <ul className="flex flex-col gap-3" data-video-lesson-list data-async-content="video-lessons">
      {openable.map((row) => (
        <li key={row.videoLesson.id}>
          <Card data-video-lesson-entry={row.videoLesson.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">{row.videoLesson.title}</p>
                <p className="mt-0.5 text-xs text-ink-300">
                  {row.courseTitle} · {row.moduleTitle} · {row.unitTitle}
                </p>
              </div>
              <StateBadge state={row.state} />
            </div>
            {row.videoLesson.beforeYouWatch && (
              <p className="mt-2 text-xs leading-relaxed text-ink-500">{row.videoLesson.beforeYouWatch}</p>
            )}
            <div className="mt-3">
              <Link
                href={`/courses/${row.courseSlug}/lessons/${row.lesson.id}`}
                className="btn-secondary "
                data-video-lesson-open
              >
                {t.open} →
              </Link>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function VideoLessonsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3" data-async-loading="video-lessons">
      {[0, 1, 2].map((row) => <div key={row} className="h-24 animate-pulse rounded-xl bg-ink-50" />)}
    </div>
  );
}

export default async function VideoLessonsPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.videoLessons;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-route-usable="video-lessons">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.intro}</p>
      </div>
      <Suspense fallback={<VideoLessonsSkeleton />}>
        <VideoLessonsContent user={user} dict={dict} />
      </Suspense>
    </div>
  );
}
