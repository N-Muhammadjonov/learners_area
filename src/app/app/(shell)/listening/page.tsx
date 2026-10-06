import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
import { FullListeningLibrary } from "@/components/listening/FullListeningLibrary";
import { fullListeningCards } from "@/lib/data/full-listening";
import { Suspense } from "react";
import { requireActiveUser } from "@/lib/auth/current-user";
import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { legacyListeningCards } from "@/lib/data/listening";

async function ActiveListeningTests({
  userId,
  page,
  dict,
}: {
  userId: string;
  page: number;
  dict: ReturnType<typeof getDictionary>;
}) {
  const [tests, full] = await Promise.all([
    legacyListeningCards(userId),
    fullListeningCards(userId, page),
  ]);
  return (
    <>
      {full.unavailable && (
        <RegionFailureNotice
          region="full-listening-schema"
          message="Full Listening is unavailable until the QA database schema is updated."
          retryLabel={dict.errorPage.retry}
        />
      )}
      <FullListeningLibrary cards={[...full.rows,...tests]} dict={dict} />
      {page > 1 && (
        <Link className="btn-secondary" href={`/app/listening?page=${page - 1}`}>
          {dict.fullListeningHub.library.previous}
        </Link>
      )}
      {full.hasMore && (
        <Link className="btn-secondary" href={`/app/listening?page=${page + 1}`}>
          More tests →
        </Link>
      )}

    </>
  );
}

function ListeningTestsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      data-listening-tests-skeleton
      data-async-loading="listening-tests"
    >
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="h-40 animate-pulse rounded-xl bg-ink-50" />
      ))}
    </div>
  );
}

export default async function ListeningPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const query = await searchParams;
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1),
  );
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;

  const dict = getDictionary(locale);
  return (
    <div
      className="mx-auto flex max-w-[1840px] flex-col gap-6"
      data-route-usable="listening"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl text-ink-900">🎧 Listening</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/app/listening/academic" className="btn-secondary" data-listening-academic-entry>
            {dict.listening.academic.title} →
          </Link>
          <Link href="/app/listening/lessons" className="btn-secondary" data-listening-lessons-entry>
            {dict.listening.lessons.title} →
          </Link>
          <Link href="/app/listening/history" className="btn-secondary ">
            {dict.listening.historyTitle} →
          </Link>
        </div>
      </div>
      <Suspense fallback={<ListeningTestsSkeleton />}>
        <ActiveListeningTests page={page} dict={dict} userId={user.id} />
      </Suspense>
    </div>
  );
}
