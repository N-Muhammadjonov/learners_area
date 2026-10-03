import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { mayImportReading } from "@/lib/reading/permissions";
import { getDictionary, getLocale } from "@/lib/i18n";
import { BackLink } from "@/components/ui/BackLink";
import { ReadingImport } from "@/components/admin/ReadingImport";

export const metadata = { title: "Reading import" };

export default async function AdminReadingImportPage() {
  const administrator = await requireAdministrator();
  if (!administrator || !mayImportReading(administrator.role)) redirect("/dashboard");
  const dict = getDictionary(await getLocale());
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <BackLink fallbackHref="/admin/reading" label={dict.common.back} />
      <ReadingImport dict={dict} />
    </div>
  );
}
