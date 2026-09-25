import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listReports } from "@/lib/data/support";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ResolveReportButton } from "@/components/support/ResolveReportButton";

export const dynamic = "force-dynamic";

/**
 * The support inbox.
 *
 * A student never reaches this page: the role is checked here as well as in the
 * API, because hiding a menu item is not authorization.
 */
export default async function SupportInboxPage() {
  // The same gate the rest of /teacher uses, plus a redirect rather than a
  // blank page: a student who lands here goes back to their own dashboard.
  const user = await requireStaff();
  if (!user) redirect("/dashboard");
  const dict = getDictionary(getLocale());

  const reports = await listReports();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.support.inbox}</h1>
        <p className="text-sm text-ink-500">{dict.support.subtitle}</p>
      </div>

      {reports.length === 0 ? (
        <EmptyState title={dict.support.nothingYet} />
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((report) => (
            <Card key={report.id} data-report-id={report.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-900">
                  {report.route} · {report.module}
                </p>
                <span
                  className={`badge ${report.status === "resolved" ? "bg-band-good/10 text-band-good" : "bg-signal-100 text-signal-700"}`}
                  data-report-status={report.status}
                >
                  {report.status === "resolved" ? dict.support.statusResolved : dict.support.statusOpen}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-700">{report.message}</p>
              <p className="mt-2 text-xs text-ink-300">
                {report.reporterName} · {new Date(report.createdAt).toLocaleString()}
                {report.viewport ? ` · ${dict.support.viewport}: ${report.viewport}` : ""}
                {report.lastErrorCode ? ` · ${dict.support.lastError}: ${report.lastErrorCode}` : ""}
              </p>
              {report.status !== "resolved" && <ResolveReportButton id={report.id} label={dict.support.resolved} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
