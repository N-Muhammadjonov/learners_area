import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { EmptyState } from "@/components/ui/EmptyState";
import { isResourceOwnerType, listResourceOwners } from "@/lib/services/resources/owners";
import { kindLabel } from "@/lib/services/resources/labels";

export const metadata = { title: "Materials" };

/**
 * /admin/materials/<kind> — the items of one content kind.
 *
 * The rows come from the same registry that answers "may this block exist?", so
 * this list can never offer a destination the write endpoint would refuse. An
 * unknown kind is a 404 rather than an empty page: a URL that cannot mean
 * anything should not pretend to be a real screen.
 */
export default async function AdminMaterialsKindPage({ params }: { params: Promise<{ type: string }> }) {
  const administrator = await requireAdministrator();
  if (!administrator) redirect("/dashboard");
  const { type } = await params;
  if (!isResourceOwnerType(type)) notFound();

  const dict = getDictionary(await getLocale());
  const rows = await listResourceOwners(type);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4" data-materials-kind={type}>
      <Link href="/admin/materials" className="link-inline w-fit text-sm" data-materials-back>
        {dict.admin.materialsBack}
      </Link>
      <h1 className="font-display text-2xl text-ink-900">{kindLabel(dict, type)}</h1>

      {rows.length === 0 ? (
        <EmptyState title={dict.admin.materialsEmpty} body={dict.admin.materialsHint} />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/admin/materials/${type}/${row.id}`}
                className="card flex items-center justify-between gap-3 p-4 transition-colors hover:border-ink-300"
                data-materials-item={row.id}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-900">{row.title}</span>
                <span className="shrink-0 text-xs text-ink-500">
                  {row.studentVisible ? dict.admin.materialsVisible : dict.admin.materialsHidden}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
