import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { isStaff } from "@/lib/auth/roles";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listLessonLibrary } from "@/lib/content/lesson-library";
export default async function GrammarLessonsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [user, locale, query] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1));
  const library = await listLessonLibrary({ area: "grammar", limit: 24, offset: (page - 1) * 24 });
  return <div className="mx-auto flex max-w-5xl flex-col gap-5" data-route-usable="grammar-lessons">
    <Link className="link-inline" href="/app/grammar">{dict.common.back}</Link>
    <h1 className="page-title">{dict.grammar.lessonsTitle}</h1>
    {!library.rows.length && <p className="body-text" data-grammar-lessons-empty>{dict.grammar.lessonsEmpty}</p>}
    {isStaff(user.role) && <Link className="btn-secondary self-start" href="/app/grammar/lessons/author">{dict.listening.lessons.authoringPath}</Link>}
    <div className="grid gap-4 sm:grid-cols-2">{library.rows.map(lesson => <article className="card p-5" key={lesson.id} data-grammar-lesson={lesson.id}>
      <h2 className="card-title">{lesson.title}</h2>{lesson.summary && <p className="body-text">{lesson.summary}</p>}
      <Link className="btn-primary" href={`/app/grammar/lessons/${lesson.id}`}>{dict.listening.hub.open}</Link>
    </article>)}</div>
    <nav className="flex gap-3" aria-label={dict.readingHub.page}>{page > 1 && <Link href={`?page=${page-1}`}>{dict.readingHub.prevPage}</Link>}{library.hasMore && <Link href={`?page=${page+1}`}>{dict.readingHub.nextPage}</Link>}</nav>
  </div>;
}
