import { Suspense } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listStandaloneVideoLessonsForStudent, listVideoLessonsForStudent } from "@/lib/data/video-lessons";
import { isOpen, type LessonState } from "@/lib/services/lessons/state";
import { Card } from "@/components/ui/Card";
import { VideoLessonCard } from "@/components/video/VideoLessonCard";
import { timed } from "@/lib/observability/timing";

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

  const standaloneList = standalone.length > 0 ? (
    <section className="flex flex-col gap-3" data-video-standalone-list>
      <h2 className="font-display text-lg text-ink-900">{t.standaloneHeading}</h2>
      <ul className={grid} data-video-library-grid>
        {standalone.map((row) => (
          <VideoLessonCard
            key={row.id}
            entryId={row.id}
            standalone
            href={`/video-lessons/${row.id}`}
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

  if (openable.length === 0 && standaloneList) return <div className="flex flex-col gap-4" data-async-content="video-lessons">{standaloneList}</div>;

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
          href={`/courses/${row.courseSlug}/lessons/${row.lesson.id}`}
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
      {standaloneList}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg text-ink-900">{t.courseHeading}</h2>
        {courseList}
      </section>
    </div>
  ) : courseList;
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
  const t = dict.videoLessons;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4" data-route-usable="video-lessons">
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
