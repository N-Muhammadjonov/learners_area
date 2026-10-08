import { questionTypeLabel } from "@/lib/reading-labels";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { questionType, resolveQuestionType } from "@/lib/content/question-types";
import { readingTypeFacets, readingTypePassages, READING_TYPE_PAGE_SIZE } from "@/lib/data/reading-type-index";
import { StartPassageButton } from "@/components/reading/StartPassageButton";
export default async function ReadingTypesPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) {
  const [user, locale, query] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const dict = getDictionary(locale), t = dict.readingV4;
  const selected = query.type ? questionType(query.type, "reading") : null;
  if (query.type && !selected) {
    const alias = resolveQuestionType(query.type, "reading");
    if (alias) {
      const params = new URLSearchParams({type:alias.id});
      if(query.page) params.set("page",query.page);
      redirect(`/app/reading/question-types?${params}`);
    }
    notFound();
  }
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1));
  const [types, rows] = await Promise.all([readingTypeFacets(), selected ? readingTypePassages(selected.id, page) : Promise.resolve([])]);
  return <div className="flex flex-col gap-5" data-route-usable="reading-question-types">
    <Link className="link-inline" href="/app/reading">{dict.common.back}</Link>
    <h1 className="page-title">{t.selectType}</h1>
    <nav className="flex flex-wrap gap-2" aria-label={t.selectType}>{types.map(type => <Link className="btn-secondary" aria-current={type.id === selected?.id ? "page" : undefined} key={type.id} href={`/app/reading/question-types?type=${type.id}`} data-reading-type={type.id}>{questionTypeLabel(type.id,locale)} ({type.count})</Link>)}</nav>
    {!types.length && <p className="body-text">{dict.readingHub.typesEmpty}</p>}
    {selected && <><h2 className="section-title">{questionTypeLabel(selected.id,locale)}</h2>
      {!rows.length && <p className="body-text">{dict.readingHub.noResults}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{rows.slice(0, READING_TYPE_PAGE_SIZE).map(p => <article className="card p-5" key={p.id} data-reading-type-passage={p.id}>
        <h3 className="card-title">{p.title}</h3><p className="meta-text">{t.requestedType}: {questionTypeLabel(selected.id,locale)}</p>
        {p.set_id ? <Link className="btn-primary" href={`/app/reading/general/${p.set_id}?passage=${p.passage_no}&type=${selected.id}`}>{t.open}</Link> : <StartPassageButton passageId={p.id} label={t.open} />}
      </article>)}</div>
      <nav className="flex gap-3" aria-label={dict.readingHub.page}>
        {page > 1 && <Link href={`?type=${selected.id}&page=${page - 1}`}>{dict.readingHub.prevPage}</Link>}
        {rows.length > READING_TYPE_PAGE_SIZE && <Link href={`?type=${selected.id}&page=${page + 1}`}>{dict.readingHub.nextPage}</Link>}
      </nav>
    </>}
  </div>;
}
