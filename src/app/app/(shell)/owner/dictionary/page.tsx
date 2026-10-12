import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/current-user";
import { getDictionary, getLocale } from "@/lib/i18n";
import { OwnerDictionary } from "@/components/vocabulary/OwnerDictionary";
export default async function DictionaryControl() {
  const owner = await requireOwner();
  if (!owner) redirect("/app");
  return <OwnerDictionary dict={getDictionary(await getLocale())} />;
}
