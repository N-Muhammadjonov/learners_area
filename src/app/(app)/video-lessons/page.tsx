import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listVideoLessonsForStudent } from "@/lib/data/video-lessons";
import { isOpen, type LessonState } from "@/lib/services/lessons/state";
import { Card } from "@/components/ui/Card";
import { StateBadge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

/**
 * Video lessons, across every course.
 *
 * The lesson itself owns the video (see the lesson page and VideoLessonStudio);
 * this page only answers "which video lessons can I open right now". It walks the
 * course tree rather than assuming a course slug, so a second course needs no new
 * page, and a lesson that is not open is left out — the same rule the lesson page
 * applies before it renders a player.
 */
export default async function VideoLessonsPage() {
  const user = await requireActiveUser();
  if (!user) return null;

  const dict = getDictionary(await getLocale());
  const t = dict.videoLessons;
  const all = await listVideoLessonsForStudent(user.id);
  const openable = all.filter((row) => isOpen(row.state as LessonState));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.intro}</p>
      </div>

      {openable.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-500" data-video-lessons-empty>
            {t.none}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-video-lesson-list>
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
                    className="text-sm text-signal-600 hover:underline"
                    data-video-lesson-open
                  >
                    {t.open} →
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
