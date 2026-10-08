import { Suspense } from "react";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n";
import { listLearningLibrary, listLibraryFacets } from "@/lib/data/reading-library";
import { questionTypeLabel, topicLabel } from "@/lib/reading-labels";
import { ReadingFilters } from "@/components/reading/ReadingFilters";
import { ReadingPassageCard } from "@/components/reading/ReadingPassageCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconReading } from "@/components/ui/icons";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
type ReadingFilter = { status?: string; topic?: string; type?: string; query?: string; page: number };
type ReadingFacets = Awaited<ReturnType<typeof listLibraryFacets>>;
type ReadingLibrary = Awaited<ReturnType<typeof listLearningLibrary>>;
type ReadingRegionResult<T> = { value: T; unavailable: false } | { value: null; unavailable: true };
const EMPTY_READING_FACETS: ReadingFacets = { topics: [], types: [] };
function captureRegion<T>(promise: Promise<T>): Promise<ReadingRegionResult<T>> {
  return promise.then(value => ({ value, unavailable: false }), () => ({ value: null, unavailable: true }));
}
/** The existing bounded, URL-backed learning library, relocated rather than replaced. */
export function ReadingLearningLibrary({userId,lang,dict,filter}: {
  userId:string; lang:"en"|"uz"; dict:ReturnType<typeof getDictionary>; filter:ReadingFilter;
}) {
  const facetsPromise = captureRegion(listLibraryFacets(true));
  const libraryPromise = captureRegion(listLearningLibrary(userId,filter));
  return <section className="flex flex-col gap-5" data-reading-library>
    <h2 className="section-title">{dict.readingHub.library}</h2>
    <Suspense fallback={<ReadingFiltersSkeleton dict={dict} />}><ReadingFiltersRegion dict={dict} lang={lang} filter={filter} facetsPromise={facetsPromise} /></Suspense>
    <Suspense fallback={<ReadingLibrarySkeleton />}><ReadingLibraryRegion dict={dict} lang={lang} filter={filter} libraryPromise={libraryPromise} /></Suspense>
  </section>;
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
  return <LearningLibraryCards library={result.value} filter={filter} dict={dict} lang={lang} />;
}

function LearningLibraryCards({
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
    return search.toString() ? `/app/reading/general?${search.toString()}` : "/app/reading/general";
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
            <Link href="/app/reading/general" className="btn-secondary" data-reading-empty-reset>
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

