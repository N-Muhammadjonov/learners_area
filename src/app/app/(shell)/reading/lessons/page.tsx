import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listLessonLibrary } from "@/lib/content/lesson-library";
export default async function ReadingLessonsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [user, locale, query] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1));
  const library = await listLessonLibrary({ area: "reading", limit: 24, offset: (page - 1) * 24 });
  return <div className="mx-auto flex max-w-5xl flex-col gap-5" data-route-usable="reading-lessons">
    <Link className="link-inline" href="/app/reading">{dict.common.back}</Link>
    <h1 className="page-title">{dict.readingV4.products.lessons.title}</h1>
    {!library.rows.length && <p className="body-text" data-reading-lessons-empty>{dict.readingV4.lessonsEmpty}</p>}
    {isStaff(user.role) && <Link className="btn-secondary self-start" href="/app/reading/lessons/author">{dict.listening.lessons.authoringPath}</Link>}
    <div className="grid gap-4 sm:grid-cols-2">{library.rows.map(lesson => <article className="card p-5" key={lesson.id} data-reading-lesson={lesson.id}>
      <h2 className="card-title">{lesson.title}</h2>{lesson.summary && <p className="body-text">{lesson.summary}</p>}
      <Link className="btn-primary" href={`/app/reading/lessons/${lesson.id}`}>{dict.readingV4.open}</Link>
    </article>)}</div>
    <nav className="flex gap-3" aria-label={dict.readingHub.page}>{page > 1 && <Link href={`?page=${page-1}`}>{dict.readingHub.prevPage}</Link>}{library.hasMore && <Link href={`?page=${page+1}`}>{dict.readingHub.nextPage}</Link>}</nav>
  </div>;
}
