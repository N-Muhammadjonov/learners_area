import Link from "next/link";
import { BackLink } from "@/components/ui/BackLink";
import { Card } from "@/components/ui/Card";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listListeningLessons } from "@/lib/listening/lessons";

export const dynamic = "force-dynamic";

/**
 * Listening → Lessons.
 *
 * The library lists the canonical lessons that carry listening material — nothing is
 * seeded to make the page look busy, so an empty catalogue renders an honest empty
 * state. Staff additionally get the authoring path (`/app/admin/content/workspace`,
 * module "Lesson"), which is where a listening lesson is actually written; a learner
 * is never shown an authoring link.
 */
export default async function ListeningLessonsPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.listening.lessons;
  const lessons = await listListeningLessons();
  const staff = isStaff(user.role);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="listening-lessons">
      <div>
        <BackLink fallbackHref="/app/listening" label={dict.listening.practiceTitle} data-listening-lessons-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">🎧 {t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.subtitle}</p>
      </div>

      {lessons.length === 0 ? (
        <Card data-listening-lessons-empty>
          <h2 className="font-display text-lg text-ink-900">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-500">{t.emptyHint}</p>
          {staff && (
            <Link className="btn-secondary mt-3 inline-block" href="/app/admin/content/workspace" data-listening-lessons-authoring>
              {t.authoringPath}
            </Link>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-listening-lessons-grid>
          {lessons.map((lesson) => (
            <Card key={lesson.id} data-listening-lesson-card={lesson.id}>
              <div className="flex h-full flex-col gap-2">
                <p className="text-xs uppercase tracking-wide text-ink-300">{t.source[lesson.source]}</p>
                <h2 className="font-display text-lg text-ink-900">{lesson.title}</h2>
                {lesson.summary && <p className="text-sm text-ink-500">{lesson.summary}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-2 text-xs text-ink-300">
                  {lesson.estimatedMinutes ? <span>{lesson.estimatedMinutes} {t.minutes}</span> : null}
                  {lesson.hasTeacherNotes ? <span data-listening-lesson-notes>{t.hasTeacherNotes}</span> : null}
                </div>
                <Link className="btn-secondary mt-2 self-start" href={`/app/listening/lessons/${lesson.id}`} data-listening-lesson-open>
                  {t.open}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
