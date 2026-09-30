import Link from "next/link";
import { db } from "@/db/client";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { buildAttemptPayload } from "@/lib/retention/payload";
import {
  findAnyLiveAttempt,
  getRetentionSummary,
  listRetentionHistory,
} from "@/lib/data/retention-attempts";
import { RetentionSession } from "@/components/reading/RetentionSession";
import { RetentionHistory } from "@/components/reading/RetentionHistory";
import { RegionFailureNotice } from "@/components/interaction/RegionFailureNotice";

export const metadata = { title: "Retention memory" };

/**
 * Retention memory — the learner's side of the dedicated bank.
 *
 * This route used to be an unscored drill over a Reading passage chosen by a
 * `?passage=` parameter. The override replaces that completely: the text is
 * allocated by the server from the Retention bank, the score is deterministic and
 * stored, and the source leaves the payload when the reading phase ends. The
 * route is kept because learners and the Reading hub already link to it, and the
 * old query parameter is deliberately NOT read — a hand-typed passage id must not
 * be able to put arbitrary content in front of the memory exercise.
 *
 * Resilience: this page is a hub, not a scoring path. If the analytics read
 * fails, the session itself still works; if the live-attempt read fails, the
 * learner sees the level cards rather than an error page.
 */
export default async function ReadingRetentionPage() {
  const user = await requireActiveUser();
  if (!user) return null;
  const locale = await getLocale();
  const dict = getDictionary(locale);

  const live = await findAnyLiveAttempt({ userId: user.id }).catch(() => null);
  const initial = live ? await buildAttemptPayload(live, new Date(), db).catch(() => null) : null;
  const summary = await getRetentionSummary(user.id).catch(() => null);
  const history = await listRetentionHistory({ userId: user.id, page: 1 }).catch(() => null);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8" data-retention-page>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="page-title">{dict.retentionMemory.title}</h1>
          <Link href="/reading" className="link-inline">
            {dict.readingHub.title}
          </Link>
        </div>
        <p className="page-subtitle">{dict.retentionMemory.subtitle}</p>
        <p className="body-text">{dict.retentionMemory.intro}</p>
      </header>

      <RetentionSession dict={dict} initial={initial} />

      <section className="flex flex-col gap-3" data-retention-summary>
        <h2 className="section-title">{dict.retentionMemory.summaryTitle}</h2>
        {summary ? (
          <div className="panel flex flex-wrap gap-x-6 gap-y-2">
            <span className="body-text" data-retention-summary-completed>
              {dict.retentionMemory.summaryCompleted.replace("{n}", String(summary.completedCount))}
            </span>
            <span className="body-text" data-retention-summary-best>
              {summary.bestScore === null
                ? dict.retentionMemory.summaryNoResults
                : dict.retentionMemory.summaryBest.replace("{n}", String(summary.bestScore))}
            </span>
            <span className="body-text" data-retention-summary-average>
              {summary.lastTenAverage === null || summary.lastTenCount === 0
                ? dict.retentionMemory.summaryNoResults
                : dict.retentionMemory.summaryLastTen
                    .replace("{n}", String(summary.lastTenCount))
                    .replace("{average}", String(summary.lastTenAverage))}
            </span>
          </div>
        ) : (
          <RegionFailureNotice
            region="retention-summary"
            message={dict.errors.unknown}
            retryLabel={dict.errorPage.retry}
          />
        )}
      </section>

      <section className="flex flex-col gap-3" data-retention-history-section>
        <h2 className="section-title">{dict.retentionMemory.historyTitle}</h2>
        {history ? (
          <RetentionHistory
            dict={dict}
            initial={{
              rows: history.rows.map((row) => ({
                attemptId: row.attemptId,
                level: row.level,
                score: row.score,
                status: row.status === "timed_out" ? ("timed_out" as const) : ("completed" as const),
                completedAt: row.completedAt,
                createdAt: row.createdAt,
              })),
              page: history.page,
              pageCount: history.pageCount,
              total: history.total,
            }}
          />
        ) : (
          <RegionFailureNotice
            region="retention-history"
            message={dict.errors.unknown}
            retryLabel={dict.errorPage.retry}
          />
        )}
      </section>
    </div>
  );
}
