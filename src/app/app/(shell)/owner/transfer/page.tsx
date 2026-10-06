import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { OwnershipTransferForm } from "@/components/owner/OwnershipTransferForm";

export const dynamic = "force-dynamic";

/**
 * Ownership transfer.
 *
 * The business must not be tied to one person's account forever, and it must not
 * be transferable by a stray click either: the form requires the owner's own
 * password again, and the API re-checks the role, the password and the target.
 */
export default async function OwnerTransferPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/app");

  const dict = getDictionary(await getLocale());

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <h1 className="font-display text-2xl text-ink-900">{dict.owner.transfer}</h1>
      <p className="rounded-sm bg-band-warn/10 p-3 text-xs leading-relaxed text-band-warn">
        {dict.owner.transferWarning}
      </p>
      <OwnershipTransferForm dict={dict} ownerEmail={owner.email ?? ""} />
    </div>
  );
}
