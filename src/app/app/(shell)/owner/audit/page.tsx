import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/current-user";
import { listAudit } from "@/lib/data/audit";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

/**
 * The audit trail: who changed whose role, who approved which applicant, when
 * the owner role changed hands. Rows carry ids, roles and counts — never a
 * password, a token or a piece of private student text.
 */
export default async function OwnerAuditPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/app");

  const dict = getDictionary(await getLocale());
  const rows = await listAudit(80);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{dict.owner.audit}</h1>
      {rows.length === 0 ? (
        <EmptyState icon="◔" title={dict.notifications.empty} />
      ) : (
        <Card className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 py-2 last:border-0">
              <span className="text-sm text-ink-700" data-audit-action={row.action}>
                {row.action}
              </span>
              <span className="text-xs text-ink-300">
                {row.targetType ? `${row.targetType} · ` : ""}
                {row.targetId ? `${row.targetId.slice(0, 8)}… · ` : ""}
                {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
