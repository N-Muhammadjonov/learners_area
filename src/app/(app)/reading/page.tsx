import { Suspense } from "react";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listLibrary, listLibraryFacets, readingHubCounts } from "@/lib/data/reading-library";
import { questionTypeLabel, topicLabel } from "@/lib/reading-labels";
import { ReadingFilters } from "@/components/reading/ReadingFilters";
import { ReadingPassageCard } from "@/components/reading/ReadingPassageCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconChevronRight, IconReading, IconRetention } from "@/components/ui/icons";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";

export const metadata = { title: "Reading" };

const TABS = ["academic", "videos", "general", "types", "retention"] as const;
type Tab = (typeof TABS)[number];
type ReadingFilter = { status?: string; topic?: string; type?: string; query?: string; page: number };

type ReadingFacets = Awaited<ReturnType<typeof listLibraryFacets>>;
type ReadingLibrary = Awaited<ReturnType<typeof listLibrary>>;
type ReadingRegionResult<T> = { value: T; unavailable: false } | { value: null; unavailable: true };

const EMPTY_READING_FACETS: ReadingFacets = { topics: [], types: [] };

function captureRegion<T>(promise: Promise<T>): Promise<ReadingRegionResult<T>> {
  return promise.then(
    (value) => ({ value, unavailable: false }),
    () => ({ value: null, unavailable: true }),
  );
}

function ReadingWorkspace({ userId, lang, dict, tab, filter }: {
  userId: string;
  lang: "uz" | "en";
  dict: ReturnType<typeof getDictionary>;
  tab: Tab;
  filter: ReadingFilter;
}) {
  // Start independent reads together, then let each region stream on its own.
  // A slow count or facet query must not hold the selected passage library.
  const countsPromise = captureRegion(readingHubCounts(userId));
  const facetsPromise: Promise<ReadingRegionResult<ReadingFacets>> = tab === "academic" || tab === "types"
    ? captureRegion(listLibraryFacets())
    : Promise.resolve({ value: EMPTY_READING_FACETS, unavailable: false });
  const libraryPromise: Promise<ReadingRegionResult<ReadingLibrary>> | null = tab === "academic"
    ? captureRegion(listLibrary(userId, filter))
    : null;

  const tabHref = (next: Tab) => {
    const search = new URLSearchParams();
    if (next !== "academic") search.set("tab", next);
    return search.toString() ? `/reading?${search.toString()}` : "/reading";
  };

  const tabItems: { key: Tab; label: string }[] = [
    { key: "academic", label: dict.readingHub.tabAcademic },
    { key: "videos", label: dict.readingHub.tabVideos },
    { key: "general", label: dict.readingHub.tabGeneral },
    { key: "types", label: dict.readingHub.tabTypes },
    { key: "retention", label: dict.readingHub.tabRetention },
  ];

  return (
    <div className="flex flex-col gap-8" data-reading-content data-async-content="reading">
      <header className="flex flex-col gap-2">
        <Suspense fallback={<ReadingCountsSkeleton dict={dict} />}>
          <ReadingCountsRegion countsPromise={countsPromise} dict={dict} />
        </Suspense>
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
            {item.key === "academic" && <Suspense fallback={null}><ReadingTabCount kind="academic" countsPromise={countsPromise} facetsPromise={facetsPromise} /></Suspense>}
            {item.key === "types" && <Suspense fallback={null}><ReadingTabCount kind="types" countsPromise={countsPromise} facetsPromise={facetsPromise} /></Suspense>}
          </Link>
        ))}
      </nav>

      {tab === "academic" && libraryPromise && (
        <section className="flex flex-col gap-5" data-reading-library>
          <div className="flex flex-col gap-1">
            <h2 className="section-title">{dict.readingHub.library}</h2>
            <p className="body-text">{dict.readingHub.libraryHint}</p>
          </div>
          <Suspense fallback={<ReadingFiltersSkeleton dict={dict} />}>
            <ReadingFiltersRegion dict={dict} lang={lang} filter={filter} facetsPromise={facetsPromise} />
          </Suspense>
          <Suspense fallback={<ReadingLibrarySkeleton />}>
            <ReadingLibraryRegion dict={dict} lang={lang} filter={filter} libraryPromise={libraryPromise} />
          </Suspense>
        </section>
      )}

      {tab === "videos" && (
        <section className="flex flex-col gap-4" data-reading-videos>
          <h2 className="section-title">{dict.readingHub.videosTitle}</h2>
          <EmptyState icon="▶" title={dict.readingHub.videosEmpty} body={dict.readingHub.videosEmptyHint}
            action={<Link href="/video-lessons" className="btn-secondary">{dict.readingHub.videosGoToLibrary}</Link>} />
        </section>
      )}

      {tab === "general" && (
        <section className="flex flex-col gap-4" data-reading-general>
          <h2 className="section-title">{dict.readingHub.generalTitle}</h2>
          <EmptyState icon="◆" title={dict.readingHub.generalEmpty} body={dict.readingHub.generalEmptyHint} />
        </section>
      )}

      {tab === "types" && (
        <Suspense fallback={<ReadingTypesSkeleton />}>
          <ReadingTypesRegion dict={dict} lang={lang} facetsPromise={facetsPromise} />
        </Suspense>
      )}

      {tab === "retention" && (
        <section className="flex flex-col gap-4" data-reading-retention>
          <div className="panel flex flex-col gap-3">
            <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl border border-gold/45 bg-gold/10 text-[22px] text-gold"><IconRetention /></span>
            <h2 className="section-title">{dict.readingHub.retentionTitle}</h2>
            <p className="body-text">{dict.readingHub.retentionBody}</p>
            <Link href="/reading/retention" className="btn-primary w-fit" data-retention-mode-link>{dict.readingHub.retentionAction}</Link>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="section-title">{dict.reading.historyTitle}</h2>
        <Link href="/reading/history" className="link-inline w-fit">{dict.reading.historyTitle}<IconChevronRight className="text-[15px]" /></Link>
      </section>
    </div>
  );
}

async function ReadingCountsRegion({ countsPromise, dict }: {
  countsPromise: Promise<ReadingRegionResult<Awaited<ReturnType<typeof readingHubCounts>>>>;
  dict: ReturnType<typeof getDictionary>;
}) {
  const result = await countsPromise;
  const counts = result.unavailable ? null : result.value;
  return (
    <>
      {result.unavailable && <RegionFailureNotice region="reading-hub-counts" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />}
      <p className="page-subtitle">
        {counts && counts.total > 0
          ? dict.readingHub.subtitleWithCount.replace("{n}", String(counts.total))
          : dict.readingHub.subtitle}
      </p>
    </>
  );
}

async function ReadingTabCount({ kind, countsPromise, facetsPromise }: {
  kind: "academic" | "types";
  countsPromise: Promise<ReadingRegionResult<Awaited<ReturnType<typeof readingHubCounts>>>>;
  facetsPromise: Promise<ReadingRegionResult<ReadingFacets>>;
}) {
  if (kind === "academic") {
    const result = await countsPromise;
    if (result.unavailable || result.value.total <= 0) return null;
    return <span className="tab-count">{result.value.total}</span>;
  }
  const result = await facetsPromise;
  if (result.unavailable || result.value.types.length === 0) return null;
  return <span className="tab-count">{result.value.types.length}</span>;
}

function ReadingCountsSkeleton({ dict }: { dict: ReturnType<typeof getDictionary> }) {
  return <p aria-busy="true" data-async-loading="reading-hub-counts" className="h-5 w-56 animate-pulse rounded bg-ink-50">{dict.common.loading}</p>;
}

function ReadingFiltersSkeleton({ dict }: { dict: ReturnType<typeof getDictionary> }) {
  return (
    <div aria-busy="true" data-async-loading="reading-library-facets" aria-label={dict.common.loading} className="panel flex flex-wrap gap-3">
      <span className="h-10 w-48 animate-pulse rounded bg-ink-50" />
      <span className="h-10 w-32 animate-pulse rounded bg-ink-50" />
      <span className="h-10 w-32 animate-pulse rounded bg-ink-50" />
    </div>
  );
}

function ReadingLibrarySkeleton() {
  return (
    <div aria-busy="true" data-async-loading="reading-library" className="flex flex-col gap-4">
      <div className="h-5 w-40 animate-pulse rounded bg-ink-50" />
      {[0, 1, 2].map((row) => <div key={row} className="h-36 animate-pulse rounded-xl bg-ink-50" />)}
    </div>
  );
}

function ReadingTypesSkeleton() {
  return (
    <div aria-busy="true" data-async-loading="reading-library-facets" className="flex flex-col gap-4">
      <div className="h-6 w-48 animate-pulse rounded bg-ink-50" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((row) => <div key={row} className="h-28 animate-pulse rounded-xl bg-ink-50" />)}</div>
    </div>
  );
}

async function ReadingFiltersRegion({ dict, lang, filter, facetsPromise }: {
  dict: ReturnType<typeof getDictionary>;
  lang: "uz" | "en";
  filter: ReadingFilter;
  facetsPromise: Promise<ReadingRegionResult<ReadingFacets>>;
}) {
  const result = await facetsPromise;
  const facets = result.unavailable ? EMPTY_READING_FACETS : result.value;
  const topicOptions = facets.topics.map((topic) => ({ ...topic, label: topicLabel(topic.code, lang) ?? topic.code }));
  const typeOptions = facets.types.map((type) => ({ ...type, label: questionTypeLabel(type.code, lang) ?? type.code }));
  return (
    <>
      {result.unavailable && <RegionFailureNotice region="reading-library-facets" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />}
      <ReadingFilters dict={dict} topics={topicOptions} types={typeOptions} current={{
        status: filter.status ?? "",
        topic: filter.topic ?? "",
        type: filter.type ?? "",
        query: filter.query ?? "",
      }} />
    </>
  );
}

async function ReadingLibraryRegion({ dict, lang, filter, libraryPromise }: {
  dict: ReturnType<typeof getDictionary>;
  lang: "uz" | "en";
  filter: ReadingFilter;
  libraryPromise: Promise<ReadingRegionResult<ReadingLibrary>>;
}) {
  const result = await libraryPromise;
  if (result.unavailable) {
    return <RegionFailureNotice region="reading-library" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />;
  }
  return <AcademicLibrary library={result.value} filter={filter} dict={dict} lang={lang} />;
}

async function ReadingTypesRegion({ dict, lang, facetsPromise }: {
  dict: ReturnType<typeof getDictionary>;
  lang: "uz" | "en";
  facetsPromise: Promise<ReadingRegionResult<ReadingFacets>>;
}) {
  const result = await facetsPromise;
  const types = result.unavailable ? [] : result.value.types;
  return (
    <section className="flex flex-col gap-4" data-reading-types>
      <div className="flex flex-col gap-1">
        <h2 className="section-title">{dict.readingHub.typesTitle}</h2>
        <p className="body-text">{dict.readingHub.typesHint}</p>
      </div>
      {result.unavailable && <RegionFailureNotice region="reading-library-facets" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />}
      {result.unavailable ? null : types.length === 0 ? <EmptyState icon="◆" title={dict.readingHub.typesEmpty} /> : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {types.map((type) => (
            <li key={type.code} className="panel flex flex-col gap-2">
              <span className="card-title">{questionTypeLabel(type.code, lang)}</span>
              <span className="meta-text">{dict.readingHub.typesCount.replace("{n}", String(type.count))}</span>
              <Link href={`/reading?type=${encodeURIComponent(type.code)}`} className="mt-1 inline-flex items-center gap-1 text-[0.875rem] font-medium text-signal-600 hover:underline" data-reading-type-link={type.code}>
                {dict.readingHub.typesPractice}<IconChevronRight className="text-[15px]" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function ReadingPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, lang, params] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const dict = getDictionary(lang);
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const requestedTab = first(params.tab);
  const tab: Tab = (TABS as readonly string[]).includes(requestedTab ?? "") ? requestedTab as Tab : "academic";
  const filter: ReadingFilter = {
    status: first(params.status), topic: first(params.topic), type: first(params.type), query: first(params.q),
    page: Number(first(params.page) ?? "1") || 1,
  };

  return (
    <div className="flex flex-col gap-8" data-reading-hub data-route-usable="reading">
      <header><h1 className="page-title">{dict.readingHub.title}</h1></header>
      <ReadingWorkspace userId={user.id} lang={lang} dict={dict} tab={tab} filter={filter} />
    </div>
  );
}

function AcademicLibrary({
  library,
  filter,
  dict,
  lang,
}: {
  library: ReadingLibrary;
  filter: ReadingFilter;
  dict: ReturnType<typeof getDictionary>;
  lang: "uz" | "en";
}) {
  /* The total arrives with the page rows (`count(*) over ()`), avoiding extra count reads. */
  const buildPageHref = (page: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filter, page })) {
      if (value && key !== "page") search.set(key === "query" ? "q" : key, String(value));
    }
    if (page > 1) search.set("page", String(page));
    return search.toString() ? `/reading?${search.toString()}` : "/reading";
  };

  return (
    <>
      <p className="meta-text" data-reading-count>
        {dict.readingHub.resultsCount.replace("{n}", String(library.total))}
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
            {library.page > 1 && <Link href={buildPageHref(library.page - 1)} className="btn-secondary" data-reading-page-prev>{dict.readingHub.prevPage}</Link>}
            {library.page < library.pageCount && <Link href={buildPageHref(library.page + 1)} className="btn-secondary" data-reading-page-next>{dict.readingHub.nextPage}</Link>}
          </div>
        </nav>
      )}
    </>
  );
}
