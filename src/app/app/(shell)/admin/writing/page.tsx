import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { BackLink } from "@/components/ui/BackLink";
import { PublicationControl } from "@/components/admin/PublicationControl";
import { listWritingContent, writingAdminCounts } from "@/lib/services/writing/admin";
import { safeWritingQuery } from "@/lib/writing/safe-query";
import { NotMigrated } from "@/components/writing/workspace/NotMigrated";
import { PUBLICATION_TYPE, WRITING_ADMIN_KINDS, isWritingAdminKind, type WritingAdminKind } from "@/lib/writing/admin-schemas";

export const dynamic = "force-dynamic";
export const metadata = { title: "Writing Content" };

/** Section from ?section= (accepts "exam" as the legacy alias of exam prompts). */
function parseSection(v: string | undefined): WritingAdminKind | "topic" {
  if (v === "exam") return "prompt";
  if (v === "topic") return "topic";
  return isWritingAdminKind(v) ? v : "lesson";
}

/**
 * /admin/writing — the ONE canonical Writing Management area (ADMIN/OWNER).
 * Counts are counted from the tables; every list row has Edit + the shared
 * publication control (with localized publish blockers).
 */
export default async function AdminWritingPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/app/dashboard");
  const dict = getDictionary(await getLocale());
  const t = dict.admin.writingAdmin;
  const section = parseSection((await searchParams).section);
  const loaded = await safeWritingQuery(() => Promise.all([writingAdminCounts(), section === "topic" ? Promise.resolve([]) : listWritingContent(section)]));
  if (!loaded.ok) return <div className="mx-auto max-w-6xl"><NotMigrated dict={dict} /></div>;
  const [counts, rows] = loaded.value;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5" data-admin-writing data-admin-writing-section={section}>
      <BackLink fallbackHref="/app/management" label={t.backManagement} />
      <div>
        <h1 className="font-display text-2xl text-ink-900">{t.title}</h1>
        <p className="mt-1 max-w-3xl text-base text-ink-500">{t.intro}</p>
      </div>

      <nav aria-label={t.title} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...WRITING_ADMIN_KINDS, "topic" as const].map((k) => {
          const c = k === "topic" ? null : counts[k];
          const active = k === section;
          return (
            <Link key={k} href={`/app/admin/writing?section=${k === "prompt" ? "exam" : k}`} aria-current={active ? "page" : undefined} data-admin-writing-card={k}
              className={`flex min-h-11 flex-col gap-2 rounded-xl border p-4 transition-colors motion-lift ${active ? "border-signal-500 bg-signal-50 dark:bg-signal-950/40" : "border-ink-100 bg-paper-raised hover:border-ink-300"}`}>
              <span className="font-display text-lg text-ink-900">{t.sections[k]}</span>
              <span className="text-sm text-ink-500">{t.sectionBody[k]}</span>
              {c && (
                <span className="flex flex-wrap gap-1 text-xs" data-admin-writing-counts={k}>
                  <span className="badge bg-paper-sunken text-ink-700">{t.counts.total} {c.total}</span>
                  <span className="badge bg-paper-sunken text-ink-500">{t.counts.draft} {c.draft}</span>
                  <span className="badge bg-gold/20 text-ink-900">{t.counts.scheduled} {c.scheduled}</span>
                  <span className="badge bg-band-good/15 text-band-good">{t.counts.published} {c.published}</span>
                  <span className="badge bg-paper-sunken text-ink-300">{t.counts.archived} {c.archived}</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {section === "topic" ? (
        <section className="flex flex-col gap-3 rounded-xl border border-ink-100 bg-paper-raised p-4" data-admin-writing-topic>
          <h2 className="font-display text-xl text-ink-900">{t.sections.topic}</h2>
          <p className="text-base text-ink-700">{t.sectionBody.topic}</p>
          <Link href="/app/vocabulary" className="btn-secondary min-h-11 self-start">{t.topicLink}</Link>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl text-ink-900">{t.sections[section]}</h2>
            <Link href={`/app/admin/writing/${section}/new`} className="btn-primary min-h-11" data-admin-writing-new={section}>+ {t.newItem}</Link>
          </div>
          {rows.length === 0 ? <p role="status" className="rounded-md bg-paper-sunken p-4 text-base text-ink-700">{t.empty}</p> : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 rounded-xl border border-ink-100 bg-paper-raised p-4 md:flex-row md:items-center md:justify-between" data-admin-writing-row={r.id}>
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-ink-900">{r.title}</p>
                    <p className="text-sm text-ink-500">{r.subtitle}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/app/admin/writing/${section}/${r.id}`} className="btn-secondary min-h-11">{t.edit}</Link>
                    <PublicationControl type={PUBLICATION_TYPE[section]} id={r.id} state={r.publicationState} publishAt={r.publishAt} dict={dict} issueLabels={t.issues} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
