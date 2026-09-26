import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import {
  countLibrary,
  listLibrary,
  listLibraryFacets,
  readingHubCounts,
  READING_PAGE_SIZE,
} from "@/lib/data/reading-library";
import { questionTypeLabel, topicLabel } from "@/lib/reading-labels";
import { ReadingFilters } from "@/components/reading/ReadingFilters";
import { ReadingPassageCard } from "@/components/reading/ReadingPassageCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconChevronRight, IconPlay, IconReading, IconRetention } from "@/components/ui/icons";

export const metadata = { title: "Reading" };

const TABS = ["academic", "videos", "general", "types", "retention"] as const;
type Tab = (typeof TABS)[number];

/**
 * The Reading hub.
 *
 * Before this page the module was one flat list of every passage that existed,
 * which is how a library of 105 items ends up looking like an empty page with a
 * scrollbar: nothing tells the student where to start, and nothing tells them
 * what they have already done.
 *
 * The tabs are the five ways into reading, and the counts are real — they are
 * counted in the database, not written into the copy. The one thing this page
 * will not do is pretend: General Training has no material yet, so it says so
 * and explains where it will appear, rather than showing an empty grid.
 */
export default async function ReadingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireActiveUser();
  if (!user) return null;

  const lang = await getLocale();
  const dict = getDictionary(lang);
  const params = await searchParams;

  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const requestedTab = first(params.tab);
  const tab: Tab = (TABS as readonly string[]).includes(requestedTab ?? "") ? (requestedTab as Tab) : "academic";
  const page = Number(first(params.page) ?? "1") || 1;

  const filter = {
    status: first(params.status),
    topic: first(params.topic),
    type: first(params.type),
    query: first(params.q),
    page,
  };

  const [counts, facets] = await Promise.all([readingHubCounts(user.id), listLibraryFacets()]);

  const tabHref = (next: Tab) => {
    const search = new URLSearchParams();
    if (next !== "academic") search.set("tab", next);
    return search.toString() ? `/reading?${search.toString()}` : "/reading";
  };

  const tabItems: { key: Tab; label: string; count?: number }[] = [
    { key: "academic", label: dict.readingHub.tabAcademic, count: counts.total },
    { key: "videos", label: dict.readingHub.tabVideos },
    { key: "general", label: dict.readingHub.tabGeneral },
    { key: "types", label: dict.readingHub.tabTypes, count: facets.types.length },
    { key: "retention", label: dict.readingHub.tabRetention },
  ];

  return (
    <div className="flex flex-col gap-8" data-reading-hub>
      <header className="flex flex-col gap-2">
        <h1 className="page-title">{dict.readingHub.title}</h1>
        <p className="page-subtitle">{dict.readingHub.subtitle}</p>
      </header>

      <nav aria-label={dict.readingHub.tabsLabel} className="flex flex-wrap gap-2" data-reading-tabs>
        {tabItems.map((item) => (
          <Link
            key={item.key}
            href={tabHref(item.key)}
            className={item.key === tab ? "tab tab-active" : "tab"}
            data-reading-tab={item.key}
            aria-current={item.key === tab ? "page" : undefined}
          >
            {item.label}
            {typeof item.count === "number" && item.count > 0 && <span className="tab-count">{item.count}</span>}
          </Link>
        ))}
      </nav>

      {tab === "academic" && <AcademicLibrary user={user.id} filter={filter} dict={dict} lang={lang} facets={facets} />}

      {tab === "videos" && (
        <section className="flex flex-col gap-4" data-reading-videos>
          <h2 className="section-title">{dict.readingHub.videosTitle}</h2>
          <EmptyState
            icon="▶"
            title={dict.readingHub.videosEmpty}
            body={dict.readingHub.videosEmptyHint}
            action={
              <Link href="/video-lessons" className="btn-secondary">
                {dict.readingHub.videosGoToLibrary}
              </Link>
            }
          />
        </section>
      )}

      {tab === "general" && (
        <section className="flex flex-col gap-4" data-reading-general>
          <h2 className="section-title">{dict.readingHub.generalTitle}</h2>
          <EmptyState icon="◆" title={dict.readingHub.generalEmpty} body={dict.readingHub.generalEmptyHint} />
        </section>
      )}

      {tab === "types" && (
        <section className="flex flex-col gap-4" data-reading-types>
          <div className="flex flex-col gap-1">
            <h2 className="section-title">{dict.readingHub.typesTitle}</h2>
            <p className="body-text">{dict.readingHub.typesHint}</p>
          </div>
          {facets.types.length === 0 ? (
            <EmptyState icon="◆" title={dict.readingHub.typesEmpty} />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {facets.types.map((type) => (
                <li key={type.code} className="panel flex flex-col gap-2">
                  <span className="card-title">{questionTypeLabel(type.code, lang)}</span>
                  <span className="meta-text">{dict.readingHub.typesCount.replace("{n}", String(type.count))}</span>
                  <Link
                    href={`/reading?type=${encodeURIComponent(type.code)}`}
                    className="mt-1 inline-flex items-center gap-1 text-[0.875rem] font-medium text-signal-600 hover:underline"
                    data-reading-type-link={type.code}
                  >
                    {dict.readingHub.typesPractice}
                    <IconChevronRight className="text-[15px]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "retention" && (
        <section className="flex flex-col gap-4" data-reading-retention>
          <div className="panel flex flex-col gap-3">
            <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold/45 bg-gold/10 text-[22px] text-gold">
              <IconRetention />
            </span>
            <h2 className="section-title">{dict.readingHub.retentionTitle}</h2>
            <p className="body-text">{dict.readingHub.retentionBody}</p>
            <Link href="/reading/retention" className="btn-primary w-fit" data-retention-mode-link>
              {dict.readingHub.retentionAction}
            </Link>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="section-title">{dict.reading.historyTitle}</h2>
        <Link href="/reading/history" className="link-inline w-fit">
          {dict.reading.historyTitle}
          <IconChevronRight className="text-[15px]" />
        </Link>
      </section>
    </div>
  );
}

async function AcademicLibrary({
  user,
  filter,
  dict,
  lang,
  facets,
}: {
  user: string;
  filter: { status?: string; topic?: string; type?: string; query?: string; page?: number };
  dict: ReturnType<typeof getDictionary>;
  lang: "uz" | "en";
  facets: Awaited<ReturnType<typeof listLibraryFacets>>;
}) {
  const library = await listLibrary(user, filter);
  const filtered = await countLibrary(user, filter);

  const buildPageHref = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filter, page })) {
      if (value && key !== "page") search.set(key, String(value));
    }
    if (page > 1) search.set("page", String(page));
    return search.toString() ? `/reading?${search.toString()}` : "/reading";
  };

  const topicOptions = facets.topics.map((topic) => ({
    ...topic,
    label: topicLabel(topic.code, lang) ?? topic.code,
  }));
  const typeOptions = facets.types.map((type) => ({
    ...type,
    label: questionTypeLabel(type.code, lang) ?? type.code,
  }));

  return (
    <section className="flex flex-col gap-5" data-reading-library>
      <div className="flex flex-col gap-1">
        <h2 className="section-title">{dict.readingHub.library}</h2>
        <p className="body-text">{dict.readingHub.libraryHint}</p>
      </div>

      <ReadingFilters
        dict={dict}
        topics={topicOptions}
        types={typeOptions}
        current={{
          status: filter.status ?? "",
          topic: filter.topic ?? "",
          type: filter.type ?? "",
          query: filter.query ?? "",
        }}
      />

      <p className="meta-text" data-reading-count>
        {dict.readingHub.resultsCount.replace("{n}", String(filtered))}
      </p>

      {library.items.length === 0 ? (
        <EmptyState
          icon={<IconReading />}
          title={dict.readingHub.noResults}
          body={dict.readingHub.noResultsHint}
          action={
            <Link href="/reading" className="btn-secondary" data-reading-empty-reset>
              {dict.readingHub.filterReset}
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {library.items.map((passage) => (
            <ReadingPassageCard key={passage.id} passage={passage} dict={dict} lang={lang} />
          ))}
        </div>
      )}

      {library.pageCount > 1 && (
        <nav className="flex flex-wrap items-center justify-between gap-3" aria-label={dict.readingHub.page}>
          <span className="meta-text" data-reading-page>
            {dict.readingHub.page} {library.page} / {library.pageCount}
          </span>
          <div className="flex items-center gap-2">
            {library.page > 1 && (
              <Link href={buildPageHref(library.page - 1)} className="btn-secondary" data-reading-page-prev>
                {dict.readingHub.prevPage}
              </Link>
            )}
            {library.page < library.pageCount && (
              <Link href={buildPageHref(library.page + 1)} className="btn-secondary" data-reading-page-next>
                {dict.readingHub.nextPage}
              </Link>
            )}
          </div>
        </nav>
      )}

      <p className="sr-only">{READING_PAGE_SIZE}</p>
    </section>
  );
}
