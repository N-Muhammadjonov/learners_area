import { Suspense } from "react";
import Link from "next/link";
import { db } from "@/db/client";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import type { Dictionary } from "@/lib/i18n/en";
import { buildAttemptPayload } from "@/lib/retention/payload";
import { findAnyLiveAttempt, getRetentionSummary, listRetentionHistory } from "@/lib/data/retention-attempts";
import { RetentionWorkspace } from "@/components/reading/RetentionWorkspace";
import { RetentionHistory } from "@/components/reading/RetentionHistory";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";
import { timed } from "@/lib/observability/timing";

export const metadata = { title: "Retention memory" };

function Failure({ dict, region }: { dict: Dictionary; region: string }) {
  return <RegionFailureNotice region={region} message={dict.retentionMemory.errors.retention_unavailable} retryLabel={dict.errorPage.retry} />;
}
function Loading({ region, label }: { region: string; label: string }) {
  return <p className="panel meta-text" role="status" data-async-loading={region}>{label}</p>;
}

async function SessionRegion({ userId, dict }: { userId: string; dict: Dictionary }) {
  const t = dict.retentionMemory;
  const overview = <aside className="flex flex-col gap-4">
    <Suspense fallback={<Loading region="retention-summary" label={dict.common.loading} />}>
      <SummaryRegion userId={userId} dict={dict} />
    </Suspense>
    <section className="panel flex flex-col gap-3" data-retention-instructions>
      <h2 className="section-title">{t.howTitle}</h2>
      <ol className="list-decimal space-y-3 pl-5 body-text">
        <li>{t.readingHint}</li><li>{t.recallHint}</li><li>{t.resultHint}</li>
      </ol>
    </section>
  </aside>;
  const history = <section className="flex flex-col gap-3" data-retention-history-section>
    <h2 className="section-title">{t.historyTitle}</h2>
    <Suspense fallback={<Loading region="retention-history" label={dict.common.loading} />}>
      <HistoryRegion userId={userId} dict={dict} />
    </Suspense>
  </section>;
  try {
    const live = await timed("retention.live", () => findAnyLiveAttempt({ userId }));
    const initial = live ? await timed("retention.payload", () => buildAttemptPayload(live, new Date(), db)) : null;
    return <RetentionWorkspace dict={dict} initial={initial} overview={overview} history={history} />;
  } catch {
    // A failed active-attempt query is not evidence that no live attempt exists.
    // Do not offer Start until the fresh authenticated read succeeds.
    return <div className="flex flex-col gap-6">
      <div className="retention-hub-grid">
        <Failure dict={dict} region="retention-session" />
        {overview}
      </div>
      {history}
    </div>;
  }
}

async function SummaryRegion({ userId, dict }: { userId: string; dict: Dictionary }) {
  try {
    const summary = await timed("retention.summary", () => getRetentionSummary(userId));
    const t = dict.retentionMemory;
    return (
      <section className="panel flex flex-col gap-4" data-retention-summary data-async-content="retention-summary">
        <h2 className="section-title">{t.summaryTitle}</h2>
        <dl className="retention-summary-grid">
          <div><dd data-retention-summary-best>{summary.bestScore ?? "—"}</dd><dt>{t.summaryBestLabel}</dt></div>
          <div><dd data-retention-summary-completed>{summary.completedCount}</dd><dt>{t.summaryCompletedLabel}</dt></div>
          <div><dd data-retention-summary-average>{summary.lastTenAverage ?? "—"}</dd><dt>{t.summaryAverageLabel}</dt></div>
        </dl>
        {summary.lastTenCount === 0 && <p className="meta-text">{t.summaryNoResults}</p>}
      </section>
    );
  } catch { return <Failure dict={dict} region="retention-summary" />; }
}

async function HistoryRegion({ userId, dict }: { userId: string; dict: Dictionary }) {
  try {
    const history = await timed("retention.history", () => listRetentionHistory({ userId, page: 1 }));
    return <RetentionHistory dict={dict} initial={{ ...history, rows: history.rows.map((row) => ({
      attemptId: row.attemptId, level: row.level, score: row.score,
      status: row.status === "timed_out" ? "timed_out" as const : "completed" as const,
      completedAt: row.completedAt, createdAt: row.createdAt,
      label: row.label, recallWordCount: row.recallWordCount,
    })) }} />;
  } catch { return <Failure dict={dict} region="retention-history" />; }
}

export default async function ReadingRetentionPage() {
  const [user, locale] = await Promise.all([requireActiveUser(), getLocale()]);
  if (!user) return null;
  const dict = getDictionary(locale);
  const t = dict.retentionMemory;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" data-retention-page data-route-usable="retention">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="page-title">{t.title}</h1>
          <Link href="/app/reading" className="btn-secondary">{dict.readingHub.title}</Link>
        </div>
        <p className="page-subtitle">{t.subtitle}</p>
        <p className="body-text">{t.intro}</p>
      </header>
      <Suspense fallback={<Loading region="retention-session" label={dict.common.loading} />}>
        <SessionRegion userId={user.id} dict={dict} />
      </Suspense>
    </div>
  );
}
