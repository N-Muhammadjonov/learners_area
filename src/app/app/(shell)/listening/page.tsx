import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ListeningPage({
  searchParams,
}: {
  /** Older links carry `?page=`; the hub lists nothing, so the parameter is accepted and unused. */
  searchParams: Promise<{ page?: string }>;
}) {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale(), searchParams]);
  if (!user) return null;

  const dict = getDictionary(locale);
  const t = dict.listening.hub;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-route-usable="listening">
      <div>
        <h1 className="font-display text-2xl text-ink-900">🎧 {t.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{t.subtitle}</p>
      </div>

      {/* The learner's own record — not a product, and it says so. */}
      <p className="text-xs text-ink-300">
        <Link className="underline" href="/app/listening/history" data-listening-history-entry>
          {dict.listening.historyTitle}
        </Link>
      </p>
    </div>
  );
}
