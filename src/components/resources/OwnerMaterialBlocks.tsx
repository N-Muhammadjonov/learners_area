import { toResourceBlockView, listResourceBlocks } from "@/lib/data/resources";
import type { ResourceOwnerType } from "@/lib/services/resources/owners";
import { ResourceBlocks } from "@/components/resources/ResourceBlocks";
import { getDictionary, getLocale } from "@/lib/i18n";

/**
 * The read-only half of a content kind's materials, for a student page.
 *
 * `ResourceBlocks` already renders nothing when the list is empty, so a passage
 * or a lesson without attachments shows no empty section — the page simply does
 * not grow a heading for material that does not exist.
 *
 * Reading is authorized by `/api/resources/<key>` on every request, and the
 * attachment is only offered when the owner is visible to students, so a draft's
 * material cannot appear here even if a stale page is cached.
 */
export async function OwnerMaterialBlocks({
  ownerType,
  ownerId,
  ownerVisible,
}: {
  ownerType: ResourceOwnerType;
  ownerId: string;
  /** Whether a student may see the owner at all — a draft shows nothing. */
  ownerVisible: boolean;
}) {
  if (!ownerVisible) return null;
  const blocks = toResourceBlockView(await listResourceBlocks(ownerType, ownerId));
  if (blocks.length === 0) return null;

  const locale = await getLocale();
  const dict = getDictionary(locale);
  return <ResourceBlocks dict={dict} blocks={blocks} />;
}
