import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listGeneralSets } from "@/lib/data/general-reading";
export default async function AcademicReadingPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [user, locale, query] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1));
  const sets = await listGeneralSets(user.id, { page, academic: true });
  return <div className="mx-auto flex max-w-5xl flex-col gap-5" data-route-usable="reading-academic">
    <Link className="link-inline" href="/app/reading">{dict.common.back}</Link>
    <h1 className="page-title">{dict.readingV4.products.academic.title}</h1>
    <p className="body-text">{dict.readingHub.academicExamHint}</p>
    {!sets.length && <p className="body-text">{dict.generalReading.empty}</p>}
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
