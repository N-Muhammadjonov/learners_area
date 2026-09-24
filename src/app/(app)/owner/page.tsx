import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/current-user";
import { countPeople } from "@/lib/data/people";
import { listPendingAccessRequests } from "@/lib/data/admission";
import { integrationReport } from "@/lib/services/integrations";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card, StatCard } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

/**
 * The owner console.
 *
 * OWNER is not a decorated admin: it is the role that may change anybody's role,
 * suspend an account, transfer the business and see integration *state*. It is
 * resolved from the database on this request — the page is not hidden behind a
 * client-side check.
 */
export default async function OwnerPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/dashboard");

  const dict = getDictionary(getLocale());
  const [counts, pending, integrations] = await Promise.all([
    countPeople(),
    listPendingAccessRequests(),
    integrationReport(),
  ]);

  const byRole = (role: string) => counts.filter((row) => row.role === role).reduce((sum, row) => sum + row.count, 0);
  const active = counts.filter((row) => row.status === "active").reduce((sum, row) => sum + row.count, 0);
  const notConfigured = integrations.filter(
    (row) => row.state === "not_configured" || row.state === "unverified"
  ).length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.owner.title}</h1>
        <p className="text-sm text-ink-500">{dict.owner.subtitle}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={dict.people.title} value={String(counts.reduce((s, r) => s + r.count, 0))} hint={`${active} ${dict.admission.statusActive.toLowerCase()}`} />
        <StatCard label={dict.admission.title} value={String(pending.length)} />
        <StatCard label={dict.nav.teacher} value={String(byRole("teacher"))} />
        <StatCard label={dict.integration.title} value={String(notConfigured)} hint={dict.integration.notConfigured} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <OwnerLink href="/admin/admissions" title={dict.owner.admissions} body={dict.admission.explainer} />
        <OwnerLink href="/admin/people" title={dict.owner.people} body={dict.people.subtitle} />
        <OwnerLink href="/owner/integrations" title={dict.owner.integrations} body={dict.integration.subtitle} />
        <OwnerLink href="/owner/retention" title={dict.owner.retention} body={dict.retention.subtitle} />
        <OwnerLink href="/owner/audit" title={dict.owner.audit} body={dict.people.subtitle} />
        <OwnerLink href="/owner/transfer" title={dict.owner.transfer} body={dict.owner.transferWarning} />
      </div>
    </div>
  );
}

function OwnerLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="card flex flex-col gap-1 p-5 hover:border-signal-600">
      <span className="font-display text-lg text-ink-900">{title}</span>
      <span className="text-xs text-ink-500">{body}</span>
    </Link>
  );
}
