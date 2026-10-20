import { Suspense } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listStandaloneVideoLessonsForStudent, listVideoLessonsForStudent } from "@/lib/data/video-lessons";
import { isOpen, type LessonState } from "@/lib/services/lessons/state";
import { Card } from "@/components/ui/Card";
import { VideoLessonCard } from "@/components/video/VideoLessonCard";
import { timed } from "@/lib/observability/timing";
import { ModuleHeaderContent } from "@/components/shell/ModuleHeaderContent";

export const dynamic = "force-dynamic";

async function VideoLessonsContent({ user, dict }: {
  user: CurrentUser;
  dict: ReturnType<typeof getDictionary>;
}) {
  const t = dict.videoLessons;
  const [all, standalone] = await Promise.all([
    timed("videoLessons.entry.catalogue", () => listVideoLessonsForStudent(user.id)),
    timed("videoLessons.entry.standalone", () => listStandaloneVideoLessonsForStudent(user.id)),
  ]);
  const openable = all.filter((row) => isOpen(row.state as LessonState));

  const grid = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  const header = <ModuleHeaderContent><nav aria-label={t.title} className="flex min-w-0 gap-1 overflow-x-auto border-b border-ink-100" data-video-header-sections>
    {standalone.length > 0 && <a className="flex min-h-11 shrink-0 items-center px-3 text-sm" href="#video-standalone">{t.standaloneHeading}</a>}
    {(openable.length > 0 || !standalone.length) && <a className="flex min-h-11 shrink-0 items-center px-3 text-sm" href="#video-course">{t.courseHeading}</a>}
  </nav></ModuleHeaderContent>;

  const standaloneList = standalone.length > 0 ? (
    <section id="video-standalone" className="flex flex-col gap-3" data-video-standalone-list>
      <h2 className="sr-only">{t.standaloneHeading}</h2>
      <ul className={grid} data-video-library-grid>
        {standalone.map((row) => (
          <VideoLessonCard
            key={row.id}
            entryId={row.id}
            standalone
            href={`/app/video-lessons/${row.id}`}
            title={row.title}
            provider={row.provider}
            videoId={row.videoId}
            durationSeconds={row.durationSeconds}
            state={row.progressState === "completed" ? "completed" : row.progressState === "in_progress" ? "in_progress" : "available"}
            minutesLabel={t.minutes}
          />
        ))}
      </ul>
    </section>
  ) : null;

  if (openable.length === 0 && standaloneList) return <div className="flex flex-col gap-4" data-async-content="video-lessons">{header}{standaloneList}</div>;

  const courseList = openable.length === 0 ? (
    <Card>
      <p className="text-sm text-ink-500" data-video-lessons-empty>{t.none}</p>
    </Card>
  ) : (
    <ul className={grid} data-video-lesson-list data-video-library-grid data-async-content="video-lessons">
      {openable.map((row) => (
        <VideoLessonCard
          key={row.videoLesson.id}
          entryId={row.videoLesson.id}
          standalone={false}
          href={`/app/courses/${row.courseSlug}/lessons/${row.lesson.id}`}
          title={row.videoLesson.title}
          provider={row.videoLesson.provider}
          videoId={row.videoLesson.videoId}
          durationSeconds={row.videoLesson.durationSeconds}
          state={row.state}
          context={`${row.courseTitle} · ${row.unitTitle}`}
          minutesLabel={t.minutes}
        />
      ))}
    </ul>
  );

  return standaloneList ? (
    <div className="flex flex-col gap-4">
      {header}
      {standaloneList}
      <section id="video-course" className="flex flex-col gap-3">
        <h2 className="sr-only">{t.courseHeading}</h2>
        {courseList}
      </section>
    </div>
  ) : <>{header}<section id="video-course" aria-label={t.courseHeading}>{courseList}</section></>;
}

function VideoLessonsSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-async-loading="video-lessons">
      {[0, 1, 2, 3].map((row) => <div key={row} className="aspect-[4/3] animate-pulse rounded-xl bg-ink-50" />)}
    </div>
  );
}

export default async function VideoLessonsPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4" data-route-usable="video-lessons">

      <Suspense fallback={<VideoLessonsSkeleton />}>
        <VideoLessonsContent user={user} dict={dict} />
      </Suspense>
    </div>
  );
}
