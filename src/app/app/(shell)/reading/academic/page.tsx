import Link from "next/link";
import { Suspense } from "react";
import { ReadingLearningLibrary } from "@/components/reading/ReadingLearningLibrary";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listGeneralSets } from "@/lib/data/general-reading";
export default async function AcademicReadingPage({ searchParams }: { searchParams: Promise<{ page?: string; setsPage?: string; q?: string; topic?: string; type?: string; status?: string }> }) {
  const [user, locale, query] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.setsPage ?? "1", 10) || 1));
  const filter = { query: query.q, topic: query.topic, type: query.type, status: query.status,
    page: Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1)) };
  return <div className="mx-auto flex max-w-5xl flex-col gap-5" data-route-usable="reading-academic">
    <Link className="link-inline" href="/app/reading">{dict.common.back}</Link>
    <h1 className="page-title">{dict.readingV4.products.academic.title}</h1>
    <p className="body-text">{dict.readingHub.academicExamHint}</p>
    <Suspense fallback={null}><AcademicSetsRegion userId={user.id} dict={dict} page={page} /></Suspense>
    <ReadingLearningLibrary userId={user.id} lang={locale} dict={dict} filter={filter} baseHref="/app/reading/academic" />
  </section>;
}

async function AcademicSetsRegion({ userId, dict, page }: {
  userId: string; dict: ReturnType<typeof getDictionary>; page: number;
}) {
  const sets = await listGeneralSets(userId, { page, academic: true });
  // The 105 standalone passages are published in reading_passages, not
  // complete 3-passage/40-question exam sets. Avoid saying the library is empty.
  if (sets.length === 0) return null;
  return <section aria-label={dict.readingV4.products.academic.title}>
    <div className="grid gap-4 sm:grid-cols-2">{sets.slice(0,24).map(set => <article className="card flex flex-col gap-3 p-5" key={set.id} data-academic-set={set.id}>
      <h2 className="card-title">{set.title}</h2>
      <ol>{set.passages.map(p => <li key={p.passageNo}>{dict.generalReading.passageN.replace("{n}", String(p.passageNo))}: {p.title}</li>)}</ol>
      <p data-academic-state={set.assessmentStatus}>{set.assessmentStatus === "completed" ? dict.readingHub.stateCompleted : set.assessmentStatus === "in_progress" ? dict.readingHub.stateInProgress : dict.readingHub.stateNotStarted}</p>
      <Link className="btn-primary self-start" href={set.attemptId ? `/app/reading/attempts/${set.attemptId}` : `/app/reading/academic/${set.id}`}>{set.assessmentStatus === "completed" ? dict.readingV4.review : set.attemptId ? dict.readingHub.actionResume : dict.readingV4.open}</Link>
    </article>)}</div>
    <nav className="flex gap-3" aria-label={dict.readingHub.page}>
      {page > 1 && <Link href={`?page=${page-1}`}>{dict.readingHub.prevPage}</Link>}
      {sets.length > 24 && <Link href={`?page=${page+1}`}>{dict.readingHub.nextPage}</Link>}
    </nav>
  </div>;
}
