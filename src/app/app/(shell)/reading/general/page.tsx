import { ReadingLearningLibrary } from "@/components/reading/ReadingLearningLibrary";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";

/** One learning card per passage. The ordinary site wallpaper stays in the catalogue. */
export default async function GeneralReadingPage({ searchParams }: { searchParams: Promise<{page?:string;setsPage?:string;q?:string;topic?:string;type?:string;status?:string}> }) {
  const [user,locale,query]=await Promise.all([requireActiveUser(),getLocale(),searchParams]);
  if(!user)return null;
  const dict=getDictionary(locale);
  const filter={query:query.q,topic:query.topic,type:query.type,status:query.status,page:Math.max(1,Math.min(10000,Number.parseInt(query.page??"1",10)||1))};
  return <div className="flex w-full min-w-0 flex-col gap-5" data-general-reading-index><p className="body-text">{dict.generalReading.subtitle}</p><ReadingLearningLibrary userId={user.id} dict={dict} lang={locale} filter={filter}/></div>;
}
