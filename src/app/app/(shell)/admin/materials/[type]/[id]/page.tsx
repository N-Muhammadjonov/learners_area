import { DeleteMaterialButton } from "@/components/admin/DeleteMaterialButton";
import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { actorOf, requireStaff } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/validation/ids";
import { ResourceComposer } from "@/components/resources/ResourceComposer";
import { listResourceBlocks, toResourceBlockView } from "@/lib/data/resources";
import { isResourceOwnerType, loadResourceOwner, mayManageResourceOwner } from "@/lib/services/resources/owners";
import { kindLabel } from "@/lib/services/resources/labels";

export const metadata = { title: "Materials" };

/**
 * /admin/materials/<kind>/<id> — the one editor every content kind uses.
 *
 * The same `ResourceComposer` the reading passage used, with a different
 * `ownerType`. That is the whole point of the registry: a lesson, a live class and
 * a writing prompt are not three uploaders, they are three strings.
 *
 * Two guards before anything is rendered: the id must be a uuid (a malformed id
 * never reaches the database) and it must resolve through `loadResourceOwner` —
 * a block attached to an id that does not exist would be an orphan row that no
 * student could ever be shown.
 */
export default async function AdminMaterialsEditorPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const administrator = await requireStaff();
  if (!administrator) redirect("/app");
  const { type, id } = await params;
  if (!isResourceOwnerType(type) || !isUuid(id)) notFound();

  const owner = await loadResourceOwner(type, id);
  if (!owner || !mayManageResourceOwner(actorOf(administrator), owner)) notFound();

  const dict = getDictionary(await getLocale());
  const blocks = toResourceBlockView(await listResourceBlocks(type, id));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-materials-editor={type}>
      <BackLink fallbackHref={`/app/admin/materials/${type}`} label={dict.admin.materialsBack} data-materials-back />

      <div>
        <h1 className="font-display text-2xl text-ink-900">
          {dict.admin.materialsFor.replace("{name}", owner.title)}
        </h1>
        <p className="meta-text mt-1">
          {kindLabel(dict, type)} ·{" "}
          {owner.studentVisible ? dict.admin.materialsVisible : dict.admin.materialsHidden}
        </p>
        <p className="body-text mt-2">{dict.admin.materialsHint}</p>
      </div>

      {["reading","listening","writing","speaking"].includes(type)&&<DeleteMaterialButton type={type} id={id} dict={dict} backTo={`/app/admin/materials/${type}`} />}
      <ResourceComposer dict={dict} ownerType={type} ownerId={id} initial={blocks} />
    </div>
  );
}
