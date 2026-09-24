import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/current-user";
import { integrationReport } from "@/lib/services/integrations";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

const LABELS: Record<string, keyof ReturnType<typeof getDictionary>["integration"]> = {
  database: "database",
  storage: "storage",
  telegram: "telegram",
  email: "email",
  external_ai: "externalAi",
  speech_to_text: "speechToText",
};

/**
 * Integration status for the owner.
 *
 * Safe by construction: `integrationReport()` returns states and non-sensitive
 * names only. There is no code path here — or anywhere in the product — that
 * renders a key, a token, a password or a connection string into HTML.
 */
export default async function OwnerIntegrationsPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/dashboard");

  const dict = getDictionary(getLocale());
  const report = await integrationReport();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.integration.title}</h1>
        <p className="text-sm text-ink-500">{dict.integration.subtitle}</p>
      </div>

      <div className="flex flex-col gap-2">
        {report.map((row) => {
          const label = LABELS[row.key] ?? "database";
          const tone =
            row.state === "connected"
              ? "bg-band-good/10 text-band-good"
              : row.state === "error"
                ? "bg-band-bad/10 text-band-bad"
                : row.state === "unverified"
                  ? "bg-band-warn/10 text-band-warn"
                  : "bg-ink-100 text-ink-500";
          const stateLabel =
            row.state === "connected"
              ? dict.integration.connected
              : row.state === "error"
                ? dict.integration.error
                : row.state === "unverified"
                  ? dict.integration.unverified
                  : dict.integration.notConfigured;
          return (
            <Card key={row.key} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink-900">
                  {dict.integration[label] ?? row.key}
                </p>
                <p className="text-xs text-ink-300">
                  {row.detail ?? "—"} · {dict.integration.lastChecked}{" "}
                  {row.checkedAt.slice(0, 16).replace("T", " ")}
                </p>
              </div>
              <span className={`badge ${tone}`} data-integration={row.key} data-state={row.state}>
                {stateLabel}
              </span>
            </Card>
          );
        })}
      </div>

      <p className="rounded-sm bg-paper-sunken p-3 text-xs text-ink-500">
        {dict.integration.secretNote}
      </p>
    </div>
  );
}
