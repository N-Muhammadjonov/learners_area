import { Suspense } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getMockOverview } from "@/lib/data/mocks";
import { Card } from "@/components/ui/Card";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";

export const dynamic = "force-dynamic";

async function MocksContent({ user, dict }: {
  user: CurrentUser;
  dict: ReturnType<typeof getDictionary>;
}) {
  const t = dict.mocks;
  const data = await getMockOverview(user.id);

  return (
    <div className="flex flex-col gap-4" data-mocks-content data-async-content="mocks">
      {data.catalogueUnavailable && <RegionFailureNotice region="mocks-catalogue" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />}
      {data.attemptsUnavailable && <RegionFailureNotice region="mocks-attempts" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />}
      {data.attemptTitlesUnavailable && <RegionFailureNotice region="mocks-attempt-titles" message={dict.errors.unknown} retryLabel={dict.errorPage.retry} />}

      <Card data-mocks-catalogue>
        <h2 className="mb-2 font-display text-lg text-ink-900">{t.catalogue}</h2>
        {data.catalogueUnavailable ? null : data.tests.length === 0 ? (
          <p className="text-sm text-ink-500" data-mocks-empty>{t.noTests}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-ink-100">
            {data.tests.map((test) => (
              <li key={test.id} className="flex items-center justify-between py-2" data-mock-test={test.id}>
                <span className="text-sm text-ink-900">{test.title}</span>
                <span className="text-xs text-ink-300">{test.skill}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-mocks-attempts>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-ink-900">{t.myAttempts}</h2>
          {!data.attemptsUnavailable && (
            <span className="text-sm text-ink-500" data-mocks-finished={data.finishedCount}>
              {data.finishedCount} {t.finished}
            </span>
          )}
        </div>
        {data.attemptsUnavailable ? null : data.attempts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500" data-mocks-attempts-empty>{t.noAttempts}</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-ink-100">
            {data.attempts.map((attempt) => (
              <li key={attempt.id} className="flex items-center justify-between py-2" data-mock-attempt={attempt.id}>
                <span className="min-w-0 text-sm text-ink-900">{attempt.title ?? t.untitled}</span>
                <span className="shrink-0 text-xs text-ink-300" data-mock-state={attempt.finishedAt ? "finished" : "unfinished"}>
                  {attempt.finishedAt
                    ? `${t.band} ${attempt.estimatedBand ?? "—"} · ${attempt.rawScore ?? "—"} ${t.raw}`
                    : t.unfinished}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-300">{t.unfinishedNote}</p>
      </Card>
    </div>
  );
}

function MocksSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4" data-async-loading="mocks">
      <div className="h-32 animate-pulse rounded-xl bg-ink-50" />
      <div className="h-40 animate-pulse rounded-xl bg-ink-50" />
    </div>
  );
}

/** Mock runner is not enabled: the page shows only real catalogue and learner data. */
export default async function MocksPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.mocks;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-route-usable="mocks">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.nav.mocks}</h1>
        <p className="text-sm text-ink-500">{t.subtitle}</p>
      </div>
      <Card data-mocks-runner-note className="border-gold/40">
        <p className="text-sm text-ink-700">{t.runnerNote}</p>
      </Card>
      <Suspense fallback={<MocksSkeleton />}>
        <MocksContent user={user} dict={dict} />
      </Suspense>
    </div>
  );
}
