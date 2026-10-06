import Link from "next/link";
import { BackLink } from "@/components/ui/BackLink";
import { Card } from "@/components/ui/Card";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listLessonLibrary } from "@/lib/content/lesson-library";

export const dynamic = "force-dynamic";

/**
 * Listening → Lessons.
 *
 * A lesson is listed because an author CLASSIFIED it as a Listening lesson
 * (`lessons.learning_area = 'listening'`) and the centre has published it — never
 * because it happens to contain audio. Nothing is seeded to make the page look busy,
 * so an empty catalogue renders an honest empty state.
 *
 * Staff get the authoring path to the staff-safe lesson desk
 * (`/app/listening/lessons/author`), which any staff role may open; a learner never
 * sees an authoring link.
 */
export default async function ListeningLessonsPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.listening.lessons;
  // The area is a WHERE clause, so the bound applies AFTER the semantic filter: an
  // older Listening lesson can never be hidden by newer lessons from other areas.
  const library = await listLessonLibrary({ area: "listening" });
  const staff = isStaff(user.role);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="listening-lessons">
      <div>
        <BackLink fallbackHref="/app/listening" label={dict.listening.practiceTitle} data-listening-lessons-back />
        <h1 className="mt-2 font-display text-2xl text-ink-900">🎧 {t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.subtitle}</p>
      </div>

      {library.rows.length === 0 ? (
        <Card data-listening-lessons-empty>
          <h2 className="font-display text-lg text-ink-900">{t.emptyTitle}</h2>
          <p className="mt-1 text-sm text-ink-500">{t.emptyHint}</p>
          {/* Staff write lessons on the staff-safe lesson desk, which calls the same
              authoring pipeline the admin workspace does. Teachers reach it too — the
              previous target, /app/admin/content/workspace, is administrator-only, so a
              teacher was being sent to a page they could not open. */}
          {staff && (
            <Link className="btn-secondary mt-3 inline-block" href="/app/listening/lessons/author" data-listening-lessons-authoring>
              {t.authoringPath}
            </Link>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-listening-lessons-grid>
          {library.rows.map((lesson) => (
            <Card key={lesson.id} data-listening-lesson-card={lesson.id}>
              <div className="flex h-full flex-col gap-2">
                <p className="text-xs uppercase tracking-wide text-ink-300">{t.areaLabel}</p>
                <h2 className="font-display text-lg text-ink-900">{lesson.title}</h2>
                {lesson.summary && <p className="text-sm text-ink-500">{lesson.summary}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-3 pt-2 text-xs text-ink-300">
                  {lesson.estimatedMinutes ? <span>{lesson.estimatedMinutes} {t.minutes}</span> : null}
                  {lesson.hasTeacherNotes ? <span data-listening-lesson-notes>{t.hasTeacherNotes}</span> : null}
                  {lesson.hasMedia ? <span>{t.hasMedia}</span> : null}
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
