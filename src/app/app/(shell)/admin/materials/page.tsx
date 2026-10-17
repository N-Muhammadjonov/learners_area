import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { Card } from "@/components/ui/Card";
import { countResourceOwners, RESOURCE_OWNER_TYPES } from "@/lib/services/resources/owners";
import { kindLabel } from "@/lib/services/resources/labels";

export const metadata = { title: "Materials" };

/**
 * /admin/materials — one place where every kind of content can be given material.
 *
 * Why this exists: the composer was built once and mounted on a single passage.
 * That made the feature look finished while seven of the eight content kinds had
 * no surface at all — a lesson, a listening test or a live class could not be
 * given a summary, a link or an audio file, so the "universal" composer was not
 * universal in practice. Rather than scatter eight bespoke editors across eight
 * pages, every kind is listed here and every item leads to the same editor.
 *
 * Permission is not decided by this page: the editor calls
 * `requireStaff()` and the write endpoint re-checks the role, so a
 * teacher who somehow reaches the URL still cannot write a block.
 */
export default async function AdminMaterialsPage() {
  const administrator = await requireStaff();
  if (!administrator) redirect("/app");
  const dict = getDictionary(await getLocale());

  const counts = await Promise.all(
    RESOURCE_OWNER_TYPES.map(async (type) => ({ type, total: await countResourceOwners(type) }))
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4" data-materials-index>
      <div>
        <h1 className="font-display text-2xl text-ink-900">{dict.admin.materialsTitle}</h1>
        <p className="body-text mt-1">{dict.admin.materialsHint}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {counts.map(({ type, total }) => (
          <Card key={type} className="flex flex-col gap-2">
            <h2 className="card-title">{kindLabel(dict, type)}</h2>
            <p className="meta-text">{total}</p>
            <Link href={`/app/admin/materials/${type}`} className="btn-secondary self-start" data-materials-kind={type}>
              {dict.admin.contentLibraryOpen}
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
