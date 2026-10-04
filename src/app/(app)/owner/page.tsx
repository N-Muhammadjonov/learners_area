import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/current-user";
import { countPeople } from "@/lib/data/people";
import { listPendingAccessRequests } from "@/lib/data/admission";
import { integrationReport } from "@/lib/services/integrations";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card, StatCard } from "@/components/ui/Card";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { BRAND, BRAND_ASSETS, allBrandAssets } from "@/lib/config/brand";

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

  const dict = getDictionary(await getLocale());
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
        <OwnerLink href="/owner/riwi" title="RIWI control room" body="Rollout readiness and bounded fixed-fixture provider checks." />
        <OwnerLink href="/owner/retention" title={dict.owner.retention} body={dict.retention.subtitle} />
        <OwnerLink href="/owner/audit" title={dict.owner.audit} body={dict.people.subtitle} />
        <OwnerLink href="/owner/transfer" title={dict.owner.transfer} body={dict.owner.transferWarning} />
      </div>

      {/*
        The brand preview.
        This is where the master artwork belongs: the brand is the subject here,
        not a row in a navigation list. The preview also lists the six approved
        files with their configured paths, so a rename or a replacement is
        visible in one place instead of being discovered in a broken layout.
      */}
      <Card data-brand-preview>
        <h2 className="font-display text-lg text-ink-900">{dict.owner.brandTitle}</h2>
        <p className="mt-1 text-xs text-ink-500">{dict.owner.brandHint}</p>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <BrandLogo kind="master" className="h-32 max-w-full" />
          <div className="flex flex-col gap-2">
            <BrandLogo kind="horizontal" className="h-10 max-w-[min(22rem,70vw)]" />
            <BrandLogo kind="mark" className="h-10" />
          </div>
        </div>
        <dl className="mt-5 grid gap-1 text-xs text-ink-500 sm:grid-cols-2" data-brand-asset-list>
          {allBrandAssets().map((asset) => (
            <div key={asset.key} className="flex min-w-0 items-center justify-between gap-3 border-b border-ink-100 py-1">
              <dt className="shrink-0 font-medium text-ink-700">{dict.owner.brandAssets[asset.key]}</dt>
              <dd className="truncate font-mono" data-brand-asset={asset.key}>
                {asset.path}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-300">
          {BRAND.siteName} · {BRAND_ASSETS.favicon}
        </p>
      </Card>
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
