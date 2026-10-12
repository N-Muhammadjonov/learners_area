import { listeningSchemaReady } from "@/lib/data/listening-schema-ready";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/lib/auth/current-user";
import { mayImportListening } from "@/lib/listening/permissions";
import { getDictionary, getLocale } from "@/lib/i18n";
import { ListeningImport } from "@/components/listening/ListeningImport";
import { BackLink } from "@/components/ui/BackLink";

export const metadata = { title: "Listening import" };

// Management owns content import (owner decision 2026-10-02). The import API
// checks the caller's role again on every request; this page only gates rendering.
export default async function AdminListeningImportPage() {
  // Same database-backed guard as every Management page.
  const administrator = await requireAdministrator();
  if (!administrator || !mayImportListening(administrator.role)) redirect("/app");
  const dict = getDictionary(await getLocale());
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <BackLink fallbackHref="/app/admin/listening" label={dict.common.back} />
      {(await listeningSchemaReady()) ? (
        <ListeningImport dict={dict} />
      ) : (
        <div className="card space-y-4">
          <h1 className="font-display text-2xl">{dict.listeningImport.title}</h1>
          <p role="status">{dict.listeningImport.importErrors.qa_migration_0028_required}</p>
        </div>
      )}
    </div>
  );
}
