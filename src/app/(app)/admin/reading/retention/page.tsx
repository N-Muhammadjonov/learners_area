import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { listRetentionInventory, listRetentionLevelTexts, sortRetentionRows } from "@/lib/data/retention-bank";
import { RETENTION_LEVELS, isRetentionLevel, type RetentionLevel } from "@/lib/retention/levels";
import { RetentionBankPanel } from "@/components/admin/RetentionBankPanel";

export const metadata = { title: "Retention" };

/**
 * Management → Reading → Retention.
 *
 * The level grid answers "how full is the bank?" (X / 15, with the honest 15 as a
 * target rather than a cap), and the panel below it is the whole authoring
 * workflow: Add, Change (new version), Delete (archive), Restore, and both usage
 * counts. Back-navigation goes to Reading, one step up, through the same crumb
 * table the topbar uses.
 */
export default async function AdminRetentionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const dict = getDictionary(await getLocale());
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const requestedLevel = first(params.level);
  const level: RetentionLevel = isRetentionLevel(requestedLevel) ? requestedLevel : "A2";
  const filter = (() => {
    const value = first(params.filter);
    return value === "all" || value === "archived" ? value : "active";
  })();
  const sort = (() => {
    const value = first(params.sort);
    return value === "uses" || value === "newest" ? value : "label";
  })();

  const inventory = await listRetentionInventory(db);
  const rows = await sortRetentionRows(await listRetentionLevelTexts(level, filter, db), sort);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6" data-retention-admin data-route-usable="retention-admin">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="page-title">{dict.retentionMemory.admin.title}</h1>
          <Link href="/admin/reading" className="link-inline" data-retention-back>
            {dict.retentionMemory.admin.backToReading}
          </Link>
        </div>
        <p className="page-subtitle">{dict.retentionMemory.admin.subtitle}</p>
      </header>

      <section className="flex flex-col gap-3" data-retention-inventory>
        <h2 className="section-title">{dict.retentionMemory.admin.inventoryTitle}</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {inventory.map((row) => (
            <li key={row.level}>
              <Link
                href={`/admin/reading/retention?level=${row.level}`}
                className={`panel flex flex-col gap-1 hover:border-signal-400 ${row.level === level ? "border-signal-400" : ""}`}
                data-retention-inventory-level={row.level}
              >
                <span className="card-title">{dict.retentionMemory.admin.levelHeading.replace("{level}", row.level)}</span>
                <span className="body-text" data-retention-inventory-count={row.level}>
                  {row.activeCount} / {row.target}
                </span>
                <span className="meta-text">
                  {row.remainingToTarget === 0
                    ? dict.retentionMemory.admin.targetReached
                    : dict.retentionMemory.admin.toTarget.replace("{n}", String(row.remainingToTarget))}
                  {" · "}
                  {dict.retentionMemory.admin.lifetimeUses.replace("{n}", String(row.lifetimeUses))}
                </span>
                <span className="meta-text">
                  {dict.retentionMemory.admin.archivedCount.replace("{n}", String(row.archivedCount))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <RetentionBankPanel
        dict={dict}
        level={level}
        filter={filter}
        sort={sort}
        rows={rows.map((row) => ({
          textId: row.textId,
          internalLabel: row.internalLabel,
          level: row.level,
          active: row.active,
          wordCount: row.wordCount,
          versionNumber: row.versionNumber,
          currentVersionUses: row.currentVersionUses,
          lifetimeUses: row.lifetimeUses,
          updatedAt: row.updatedAt,
        }))}
      />

      <p className="meta-text" data-retention-levels-available>
        {RETENTION_LEVELS.join(" · ")}
      </p>
    </div>
  );
}
