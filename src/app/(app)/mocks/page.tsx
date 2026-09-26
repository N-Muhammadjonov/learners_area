import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getMockOverview } from "@/lib/data/mocks";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

/**
 * Mock tests — the catalogue, and this student's own attempts.
 *
 * The timed full-test runner is not enabled yet, and the page says exactly that
 * rather than pretending: what it shows is what exists in the database (the mock
 * tests the centre has configured and every attempt this student has made, with a
 * score only once an attempt was actually finished).
 */
export default async function MocksPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const dict = getDictionary(await getLocale());
  const t = dict.mocks;

  const data = await getMockOverview(user.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.nav.mocks}</h1>
        <p className="text-sm text-ink-500">{t.subtitle}</p>
      </div>

      <Card data-mocks-runner-note className="border-gold/40">
        <p className="text-sm text-ink-700">{t.runnerNote}</p>
      </Card>

      <Card data-mocks-catalogue>
        <h2 className="mb-2 font-display text-lg text-ink-900">{t.catalogue}</h2>
        {data.tests.length === 0 ? (
          <p className="text-sm text-ink-500" data-mocks-empty>
            {t.noTests}
          </p>
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
          <span className="text-sm text-ink-500" data-mocks-finished={data.finishedCount}>
            {data.finishedCount} {t.finished}
          </span>
        </div>
        {data.attempts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500" data-mocks-attempts-empty>
            {t.noAttempts}
          </p>
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
