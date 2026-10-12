import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { FullListeningLibrary } from "@/components/listening/FullListeningLibrary";
import { legacyListeningCardsPage } from "@/lib/data/listening";
import { fullListeningCards } from "@/lib/data/full-listening";

export default async function AdminListeningPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const query = await searchParams;
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1));
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/app");
  const dict = getDictionary(await getLocale());
  const [tests,legacy] = await Promise.all([fullListeningCards(administrator.id, page, true),legacyListeningCardsPage(administrator.id,true,undefined,page)]);
  return <div className="listening-workspace mx-auto flex max-w-[1840px] flex-col gap-6" data-management-listening-library>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="font-display text-2xl">{dict.admin.listeningTitle}</h1><Link className="btn-primary" href="/app/admin/listening/import" data-admin-listening-import>{dict.listeningImport.title}</Link></div>
    {tests.unavailable ? <p role="alert">{dict.errors.unknown}</p> : <FullListeningLibrary cards={[...tests.rows,...legacy.rows]} dict={dict} management />}
    <nav className="flex gap-2">{page > 1 && <Link className="btn-secondary" href={`/app/admin/listening?page=${page - 1}`}>{dict.fullListeningHub.library.previous}</Link>}{(tests.hasMore || legacy.hasMore) && <Link className="btn-secondary" href={`/app/admin/listening?page=${page + 1}`}>{dict.common.continue} →</Link>}</nav>
  </div>;
}
