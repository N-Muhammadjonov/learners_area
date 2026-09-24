import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/current-user";
import { readRetentionConfig } from "@/lib/services/retention";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { RetentionRunner } from "@/components/owner/RetentionRunner";

export const dynamic = "force-dynamic";

/**
 * The retention policy, spelled out.
 *
 * The owner can see the configured windows and run a preview before anything is
 * removed; the actual run is a second, explicit click.
 */
export default async function OwnerRetentionPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/dashboard");

  const dict = getDictionary(getLocale());
  const config = readRetentionConfig();

  const rows = [
    { label: dict.retention.inactiveStudent, value: `${config.inactiveStudentMonths} ${dict.retention.months}` },
    { label: dict.retention.rawConversations, value: `${config.rawEventMonths} ${dict.retention.months}` },
    { label: dict.retention.structuredResults, value: `${config.structuredResultMonths} ${dict.retention.months}` },
    { label: dict.retention.reportSnapshots, value: `${config.structuredResultMonths} ${dict.retention.months}` },
    { label: dict.retention.generatedExports, value: `${config.generatedExportDays} ${dict.retention.days}` },
    { label: dict.retention.auditHistory, value: `${config.auditMonths} ${dict.retention.months}` },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.retention.title}</h1>
        <p className="text-sm text-ink-500">{dict.retention.subtitle}</p>
      </div>

      <Card className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-ink-700">{row.label}</span>
            <span className="font-mono text-ink-900">{row.value}</span>
          </div>
        ))}
      </Card>

      <RetentionRunner dict={dict} />
    </div>
  );
}
