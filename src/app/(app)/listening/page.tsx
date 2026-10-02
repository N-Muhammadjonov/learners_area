import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
import { FullListeningLibrary } from "@/components/listening/FullListeningLibrary";
import { fullListeningCards } from "@/lib/data/full-listening";
import { isAdministrator } from "@/lib/auth/roles";
import { Suspense } from "react";
import { requireActiveUser } from "@/lib/auth/current-user";
import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listActiveTests } from "@/lib/data/listening";
import { Card } from "@/components/ui/Card";
import { StartTestButton } from "@/components/listening/StartTestButton";

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
    listActiveTests(),
    fullListeningCards(userId, page),
  ]);
  const fullIds = new Set(full.rows.map((t) => t.id));
  return (
    <>
      {full.unavailable && (
        <RegionFailureNotice
          region="full-listening-schema"
          message="Full Listening is unavailable until the QA database schema is updated."
          retryLabel={dict.errorPage.retry}
        />
      )}
      <FullListeningLibrary cards={full.rows} />
      {page > 1 && (
        <Link className="btn-secondary" href={`/listening?page=${page - 1}`}>
          Previous tests
        </Link>
      )}
      {full.hasMore && (
        <Link className="btn-secondary" href={`/listening?page=${page + 1}`}>
          More tests →
        </Link>
      )}
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        data-listening-tests
        data-async-content="listening-tests"
      >
        {tests
          .filter((t) => !fullIds.has(t.id))
          .map((t) => (
            <Card key={t.id} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="badge bg-signal-100 text-signal-700">
                  {t.difficultyLevel}
                </span>
              </div>
              <p className="text-sm font-medium text-ink-900">{t.title}</p>
              <div className="flex justify-end">
                <StartTestButton
                  testId={t.id}
                  label={dict.listening.startAttempt}
                  messages={dict.auth}
                />
              </div>
            </Card>
          ))}
      </div>
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
        {isAdministrator(user.role) && (
          <Link className="btn-primary" href="/admin/listening/import">
            + Add Listening
          </Link>
        )}
        <Link href="/listening/history" className="btn-secondary ">
          {dict.listening.historyTitle} →
        </Link>
      </div>
      <Suspense fallback={<ListeningTestsSkeleton />}>
        <ActiveListeningTests page={page} dict={dict} userId={user.id} />
      </Suspense>
    </div>
  );
}
