import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { readingLegacyDestination } from "@/lib/reading/destinations";

export const dynamic = "force-dynamic";
export default async function ReadingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, locale, query] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;
  const target = readingLegacyDestination(Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  if (target) redirect(target);
  const dict = getDictionary(locale);
  const t = dict.readingV4;
  return <div className="mx-auto flex max-w-5xl flex-col gap-6" data-reading-hub data-route-usable="reading">
    <header><h1 className="page-title">{dict.readingHub.title}</h1><p className="page-subtitle">{t.subtitle}</p></header>
    <Link className="link-inline w-fit" href="/app/reading/history" data-reading-history-entry>{dict.reading.historyTitle}</Link>
  </div>;
}
