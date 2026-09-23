import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getDictionary, getLocale } from "@/lib/i18n";
import { getDueVocabulary, getRecentEvaluations, getWeaknessSummary } from "@/lib/data/coach-dashboard";
import { Card, StatCard } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

/**
 * The Coach dashboard.
 *
 * Every number on this page comes from a row written by the student's own
 * evaluated work: weakness rows, evaluation rows and the spaced-repetition
 * queue. There is no trend line without data behind it, and an empty section
 * says it is empty rather than showing a placeholder percentage.
 */
export default async function CoachPage() {
  const session = await getSession();
  if (!session) return null;
  const dict = getDictionary(getLocale());
  const t = dict.coach;

  const [weaknesses, recent, due] = await Promise.all([
    getWeaknessSummary(session.sub),
    getRecentEvaluations(session.sub, 8),
    getDueVocabulary(session.sub, 10),
  ]);

  const open = weaknesses.filter((w) => w.status === "open");
  const improving = weaknesses.filter((w) => w.status !== "open");

  const statusLabel = (status: string): string =>
    status === "open" ? t.statusOpen : status === "improving" ? t.statusImproving : t.statusResolved;

  const evaluationLabel = (type: string, fallback: string): string =>
    (dict.nav as Record<string, string | undefined>)[type] ?? fallback;

  // Weakness labels are translated here rather than shipped from the data
  // layer, so the dashboard follows the reader's language.
  const categoryLabel = (category: string, fallback: string): string =>
    (t.categoryLabels as Record<string, string | undefined>)[category] ?? fallback;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{t.dashboardTitle}</h1>
        <p className="text-sm text-ink-500">{t.dashboardSubtitle}</p>
      </div>

      {weaknesses.length === 0 && recent.length === 0 ? (
        <EmptyState
          icon="◎"
          title={t.noWeaknessesYet}
          action={
            <Link href="/writing" className="btn-primary">
              {dict.dashboard.startWriting}
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={t.repeated} value={String(open.length)} />
            <StatCard label={t.improved} value={String(improving.length)} />
            <StatCard label={t.reviewToday} value={String(due.length)} />
          </div>

          {open.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-lg text-ink-900">{t.repeated}</h2>
              {open
                .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
                .map((weakness) => (
                  <Card key={weakness.category} className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-ink-900">
                        {categoryLabel(weakness.category, weakness.label)}
                      </span>
                      <span className="text-xs text-ink-300">
                        {t.seenTimes.replace("{count}", String(weakness.occurrenceCount))} ·{" "}
                        {t.lastSeen} {weakness.lastSeenAt.toISOString().slice(0, 10)} ·{" "}
                        {weakness.recentSeverity}
                      </span>
                      <span className="text-xs text-ink-500">{weakness.action}</span>
                    </div>
                    <Link href={weakness.href} className="btn-secondary">
                      {t.practiceNow}
                    </Link>
                  </Card>
                ))}
            </section>
          )}

          {improving.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-lg text-ink-900">{t.improved}</h2>
              <Card className="flex flex-col gap-2">
                {improving.map((weakness) => (
                  <div key={weakness.category} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-ink-700">
                      {categoryLabel(weakness.category, weakness.label)}
                    </span>
                    <span className="badge bg-band-good/10 text-band-good">{statusLabel(weakness.status)}</span>
                  </div>
                ))}
              </Card>
            </section>
          )}

          {due.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-lg text-ink-900">{t.reviewToday}</h2>
              <Card className="flex flex-wrap gap-2">
                {due.map((item) => (
                  <span key={item.id} className="badge bg-ink-100 text-ink-700">
                    {item.term}
                  </span>
                ))}
                <Link href="/vocabulary/review" className="text-sm text-signal-700 underline">
                  {dict.vocabulary.review}
                </Link>
              </Card>
            </section>
          )}

          {recent.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-lg text-ink-900">{t.recentEvaluations}</h2>
              <Card className="flex flex-col">
                {recent.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 py-2 last:border-0"
                  >
                    <span className="text-sm text-ink-700">
                      {evaluationLabel(row.evaluationType, row.evaluationType)}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-ink-300">
                      {row.overallEstimate !== null
                        ? `${t.estimatedBand}: ${row.overallEstimate.toFixed(1)}`
                        : row.verdict
                          ? (dict.coach.verdicts as Record<string, string>)[row.verdict]
                          : "—"}
                      <span className="badge bg-signal-100 text-signal-700" data-checked-by={row.checkedByName}>
                        {t.checkedBy} {row.checkedByName}
                      </span>
                    </span>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
