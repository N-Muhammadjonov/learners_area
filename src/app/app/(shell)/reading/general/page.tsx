import { Suspense } from "react";
import { ReadingLearningLibrary } from "@/components/reading/ReadingLearningLibrary";
import Link from "next/link";
import { BackLink } from "@/components/ui/BackLink";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listGeneralSets } from "@/lib/data/general-reading";
import { GeneralReadingSets } from "@/components/reading/GeneralReadingSets";

/** General Reading — the learning mode (develop reading), separate from IELTS Academic (measure reading). */
export default async function GeneralReadingPage({ searchParams }: { searchParams: Promise<{ page?: string; setsPage?: string; q?:string; topic?:string; type?:string; status?:string }> }) {
  const user = await requireActiveUser();
  if (!user) return null;
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const query = await searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.setsPage ?? "1", 10) || 1));
  const setsPromise = listGeneralSets(user.id, { page });
  const filter = {query:query.q, topic:query.topic, type:query.type, status:query.status, page:Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1",10)||1))};
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6" data-general-reading-index>
      <BackLink fallbackHref="/app/reading" label={dict.common.back} />
      <header className="flex flex-col gap-2">
        <h1 className="section-title">{dict.generalReading.title}</h1>
        <p className="body-text">{dict.generalReading.subtitle}</p>
      </header>
      {/* Surface the existing published 105-source passage library first: formal
          three-passage sets are a separate optional product, not the library. */}
      <ReadingLearningLibrary userId={user.id} dict={dict} lang={locale} filter={filter} />
      <Suspense fallback={null}>
        <SetsRegion setsPromise={setsPromise} dict={dict} page={page} query={query} />
      </Suspense>
    </div>
  );
}

async function SetsRegion({setsPromise,dict,page,query}:{setsPromise:ReturnType<typeof listGeneralSets>;dict:ReturnType<typeof getDictionary>;page:number;query:Record<string,string|undefined>}) {
  const sets=await setsPromise;
  if (sets.length === 0) return null;
  const href=(next:number)=>{const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value)params.set(key,value);params.set("setsPage",String(next));return `?${params}`;};
  return <section className="flex flex-col gap-3"><GeneralReadingSets dict={dict} sets={sets.slice(0,24)} />
    <nav className="flex gap-3" aria-label={dict.readingHub.page}>
      {page>1 && <Link href={href(page-1)}>{dict.readingHub.prevPage}</Link>}
      {sets.length>24 && <Link href={href(page+1)}>{dict.readingHub.nextPage}</Link>}
    </nav>
  </section>;
}
